import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./authGuard.server";

export interface DBPhoto {
  id: string;
  property_id: string;
  storage_path: string | null;
  public_url: string;
  alt: string;
  sort_order: number;
  is_cover: boolean;
  created_at?: string;
}

// Zod schemas for validation
const getSignedUploadParamsSchema = z.object({
  propertyId: z.string().min(1),
  accessToken: z.string().optional(),
});

const savePropertyPhotoSchema = z.object({
  propertyId: z.string().min(1),
  publicId: z.string().min(1),
  secureUrl: z.string().url(),
  alt: z.string().optional(),
  accessToken: z.string().optional(),
});

const listPropertyPhotosSchema = z.object({
  propertyId: z.string().min(1),
});

const deletePropertyPhotoSchema = z.object({
  id: z.string().min(1),
  accessToken: z.string().optional(),
});

const setCoverPhotoSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  accessToken: z.string().optional(),
});

const reorderPhotosSchema = z.object({
  propertyId: z.string().min(1),
  orderedIds: z.array(z.string()),
  accessToken: z.string().optional(),
});

// 1. getSignedUploadParams
export const getSignedUploadParams = createServerFn({ method: "POST" })
  .validator((data: unknown) => getSignedUploadParamsSchema.parse(data))
  .handler(async ({ data: { propertyId, accessToken } }): Promise<{
    ok: true;
    data: {
      signature: string;
      timestamp: number;
      apiKey: string;
      cloudName: string;
      folder: string;
    };
  } | {
    ok: false;
    error: string;
  }> => {
    try {
      await requireAdmin(accessToken);

      const cloudName = process.env['CLOUDINARY_CLOUD_NAME'];
      const apiKey = process.env['CLOUDINARY_API_KEY'];
      const apiSecret = process.env['CLOUDINARY_API_SECRET'];

      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error("Missing Cloudinary configuration environment variables.");
      }

      const timestamp = Math.round(Date.now() / 1000);
      const folder = `naples-coastal-stays/${propertyId}`;

      const { v2: cloudinary } = await import("cloudinary");
      const signature = cloudinary.utils.api_sign_request(
        { timestamp, folder },
        apiSecret
      );

      return {
        ok: true,
        data: {
          signature,
          timestamp,
          apiKey,
          cloudName,
          folder,
        },
      };
    } catch (e: any) {
      console.error("Error in getSignedUploadParams:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// 2. savePropertyPhoto
export const savePropertyPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => savePropertyPhotoSchema.parse(data))
  .handler(async ({ data: { propertyId, publicId, secureUrl, alt, accessToken } }): Promise<{
    ok: true;
    data: DBPhoto;
  } | {
    ok: false;
    error: string;
  }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Get existing photos for the property to determine next sort_order
      const { data: photos, error: fetchError } = await supabaseAdmin
        .from("property_photos")
        .select("sort_order")
        .eq("property_id", propertyId);

      if (fetchError) {
        console.error("Error fetching existing photos:", fetchError);
        return { ok: false, error: fetchError.message };
      }

      let sortOrder = 1;
      let isCover = true;

      if (photos && photos.length > 0) {
        const maxSortOrder = Math.max(...photos.map((p) => p.sort_order || 0));
        sortOrder = maxSortOrder + 1;
        isCover = false;
      }

      // Insert new photo
      const { data: newPhoto, error: insertError } = await (supabaseAdmin
        .from("property_photos") as any)
        .insert({
          property_id: propertyId,
          storage_path: publicId,
          public_url: secureUrl,
          alt: alt || "",
          sort_order: sortOrder,
          is_cover: isCover,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting photo:", insertError);
        return { ok: false, error: insertError.message };
      }

      return { ok: true, data: newPhoto as DBPhoto };
    } catch (e: any) {
      console.error("Error in savePropertyPhoto:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// 3. listPropertyPhotos
export const listPropertyPhotos = createServerFn({ method: "GET" })
  .validator((data: unknown) => listPropertyPhotosSchema.parse(data))
  .handler(async ({ data: { propertyId } }): Promise<DBPhoto[]> => {
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("property_photos")
      .select("*")
      .eq("property_id", propertyId)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Error fetching property photos:", error);
      throw new Error(`Failed to fetch property photos: ${error.message}`);
    }

    return (data as DBPhoto[]) || [];
  });

// 4. deletePropertyPhoto
export const deletePropertyPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => deletePropertyPhotoSchema.parse(data))
  .handler(async ({ data: { id, accessToken } }): Promise<{
    ok: true;
  } | {
    ok: false;
    error: string;
  }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Fetch the photo row to get storage_path, property_id, and is_cover
      const { data: photo, error: fetchError } = await supabaseAdmin
        .from("property_photos")
        .select("storage_path, property_id, is_cover")
        .eq("id", id)
        .maybeSingle();

      if (fetchError || !photo) {
        return { ok: false, error: fetchError?.message || "Photo not found." };
      }

      // Delete from Cloudinary if storage_path exists
      if (photo.storage_path) {
        try {
          const cloudName = process.env['CLOUDINARY_CLOUD_NAME'];
          const apiKey = process.env['CLOUDINARY_API_KEY'];
          const apiSecret = process.env['CLOUDINARY_API_SECRET'];

          if (!cloudName || !apiKey || !apiSecret) {
            console.warn("Cloudinary configuration missing during delete operation.");
          } else {
            const { v2: cloudinary } = await import("cloudinary");
            cloudinary.config({
              cloud_name: cloudName,
              api_key: apiKey,
              api_secret: apiSecret,
            });

            const destroyResult = await cloudinary.uploader.destroy(photo.storage_path);
            if (destroyResult.result !== "ok") {
              console.warn("Cloudinary returned non-ok result during destroy:", destroyResult);
            }
          }
        } catch (cloudinaryErr) {
          console.error("Failed to delete photo from Cloudinary:", cloudinaryErr);
        }
      }

      // Delete the DB row
      const { error: deleteError } = await supabaseAdmin
        .from("property_photos")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error("Error deleting photo from DB:", deleteError);
        return { ok: false, error: deleteError.message };
      }

      // If the deleted photo was is_cover, promote the now-lowest sort_order remaining photo to is_cover = true
      if (photo.is_cover) {
        const { data: remaining, error: remainingError } = await supabaseAdmin
          .from("property_photos")
          .select("id, sort_order")
          .eq("property_id", photo.property_id)
          .order("sort_order", { ascending: true });

        if (remainingError) {
          console.error("Error fetching remaining photos for cover promotion:", remainingError);
        } else if (remaining && remaining.length > 0) {
          const firstRemaining = remaining[0];
          if (firstRemaining) {
            const newCoverId = firstRemaining.id;
            const { error: updateError } = await supabaseAdmin
              .from("property_photos")
              .update({ is_cover: true })
              .eq("id", newCoverId);

            if (updateError) {
              console.error("Error setting new cover photo:", updateError);
            }
          }
        }
      }

      return { ok: true };
    } catch (e: any) {
      console.error("Error in deletePropertyPhoto:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// 5. setCoverPhoto
export const setCoverPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => setCoverPhotoSchema.parse(data))
  .handler(async ({ data: { id, propertyId, accessToken } }): Promise<{
    ok: true;
  } | {
    ok: false;
    error: string;
  }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Set is_cover=false for all photos of the property
      const { error: resetError } = await supabaseAdmin
        .from("property_photos")
        .update({ is_cover: false })
        .eq("property_id", propertyId);

      if (resetError) {
        console.error("Error resetting cover photos:", resetError);
        return { ok: false, error: resetError.message };
      }

      // Set is_cover=true for the target photo
      const { error: setError } = await supabaseAdmin
        .from("property_photos")
        .update({ is_cover: true })
        .eq("id", id);

      if (setError) {
        console.error("Error setting cover photo:", setError);
        return { ok: false, error: setError.message };
      }

      return { ok: true };
    } catch (e: any) {
      console.error("Error in setCoverPhoto:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// 6. reorderPhotos
export const reorderPhotos = createServerFn({ method: "POST" })
  .validator((data: unknown) => reorderPhotosSchema.parse(data))
  .handler(async ({ data: { propertyId, orderedIds, accessToken } }): Promise<{
    ok: true;
  } | {
    ok: false;
    error: string;
  }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Update sort_order for each photo sequentially to avoid database lock issues
      for (let i = 0; i < orderedIds.length; i++) {
        const photoId = orderedIds[i];
        if (!photoId) continue;

        const { error: updateError } = await supabaseAdmin
          .from("property_photos")
          .update({ sort_order: i })
          .eq("id", photoId)
          .eq("property_id", propertyId);

        if (updateError) {
          console.error(`Error updating sort order for photo ${photoId}:`, updateError);
          return { ok: false, error: updateError.message };
        }
      }

      return { ok: true };
    } catch (e: any) {
      console.error("Error in reorderPhotos:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });
