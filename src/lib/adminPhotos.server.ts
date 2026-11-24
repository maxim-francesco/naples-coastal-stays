import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AdminAccessError, adminErrorMessage, requireAdmin } from "./authGuard.server";
import {
  MediaError,
  NAPLES_IMAGE_MAX_BYTES,
  createPropertyUploadTicket,
  deletePropertyObject,
  managedPropertyKey,
  naplesMedia,
  propertyMediaPrefix,
  verifyPropertyUpload,
} from "./r2Media";
import { storePhotoWithVariants } from "./photoProcessing.server";
import { PHOTO_VARIANT_WIDTHS, parseR2PhotoKey, photoVariantKey } from "./responsiveImage";

export interface DBPhoto {
  id: string;
  property_id: string;
  storage_path: string | null;
  public_url: string;
  alt: string;
  sort_order: number;
  is_cover: boolean;
  is_hero?: boolean;
  created_at?: string;
}

// What happened to the stored file when a photo row was removed. The row is
// always removed first, so this only decides what the administrator is told.
export type PhotoStorageOutcome =
  "deleted" | "cleanup-pending" | "legacy-kept" | "shared-kept" | "none";

// The access token travels in the Authorization header, never in the payload:
// server function data is serialized into the query string for GET requests.
const getUploadTicketSchema = z.object({
  propertyId: z.string().min(1),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive().max(NAPLES_IMAGE_MAX_BYTES),
});

const savePropertyPhotoSchema = z.object({
  propertyId: z.string().min(1),
  key: z.string().min(1),
  mimeType: z.string().min(1),
  alt: z.string().optional(),
});

const listPropertyPhotosSchema = z.object({
  propertyId: z.string().min(1),
});

const deletePropertyPhotoSchema = z.object({
  id: z.string().min(1),
});

const setCoverPhotoSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
});

const reorderPhotosSchema = z.object({
  propertyId: z.string().min(1),
  orderedIds: z.array(z.string()),
});

// A safe, expected refusal (for example a property id that no longer exists).
// Its message is shown to the administrator; anything else is replaced by the
// caller's fallback.
class PhotoRequestError extends Error {}

async function assertPropertyExists(propertyId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
  const { data, error } = await supabaseAdmin
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) {
    console.error("Error checking property existence:", error);
    throw new Error("Could not verify the property.");
  }
  if (!data) throw new PhotoRequestError("Property not found.");
}

// Safe, user-facing messages only: storage errors carry an explicit message,
// the guard's own denials are returned verbatim, everything else (database
// failures, network errors) becomes the caller's fallback.
function publicError(e: unknown, fallback: string): string {
  if (e instanceof MediaError || e instanceof PhotoRequestError) return e.message;
  return adminErrorMessage(e, fallback);
}

function logReason(e: unknown): string {
  if (e instanceof MediaError) return e.code;
  if (e instanceof AdminAccessError) return e.failure;
  if (e instanceof PhotoRequestError) return "rejected";
  return "unexpected";
}

function mediaCode(e: unknown): string {
  return e instanceof MediaError ? e.code : "";
}

// Uploads that failed a content check are discarded so they cannot stay
// reachable at a public URL. Anything else (storage unavailable, a timeout)
// keeps the object so the administrator can retry saving it.
const DISCARDABLE_UPLOAD_ERRORS = new Set([
  "MEDIA_INVALID_SIZE",
  "MEDIA_MIME_MISMATCH",
  "MEDIA_MAGIC_MISMATCH",
]);

async function discardUploadedObject(propertyId: string, key: string): Promise<void> {
  try {
    await deletePropertyObject(propertyId, key);
  } catch {
    // Best effort: no row points at the object either way.
  }
}

// An optimised photo owns its original plus every WebP variant generated for
// it. Variant keys are derived from the original key and its width marker, so
// the whole set can be removed without listing the bucket.
function objectKeysForPhoto(key: string): string[] {
  const parts = parseR2PhotoKey(key);
  if (!parts) return [key];
  const keys = [key];
  for (const width of PHOTO_VARIANT_WIDTHS) {
    if (width > parts.width) continue;
    const variantKey = photoVariantKey(key, width);
    if (variantKey) keys.push(variantKey);
  }
  return keys;
}

async function deletePhotoFiles(
  propertyId: string,
  key: string,
): Promise<{ ok: boolean; code: string | null }> {
  let ok = true;
  let code: string | null = null;
  for (const objectKey of objectKeysForPhoto(key)) {
    try {
      await deletePropertyObject(propertyId, objectKey);
    } catch (error) {
      ok = false;
      code ||= error instanceof MediaError ? error.code : "unknown";
    }
  }
  return { ok, code };
}

// Removes the file behind a photo row that has already been deleted, and
// reports what happened to it.
async function removeStoredFile(
  storagePath: string | null,
  propertyId: string,
): Promise<PhotoStorageOutcome> {
  // Photos stored before R2 (Cloudinary originals) are never touched: their
  // reference is not a key in this property's R2 namespace.
  if (typeof storagePath !== "string" || !storagePath) return "none";
  const key = managedPropertyKey(storagePath, propertyId);
  if (!key) return "legacy-kept";

  // A key can be shared by several photo rows; the file may only go once no
  // other row points at it. If that cannot be confirmed, the file stays.
  const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
  const { count, error: countError } = await supabaseAdmin
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("storage_path", storagePath);
  if (countError) {
    console.error("Error checking remaining references to a photo file:", countError);
    return "cleanup-pending";
  }
  if (count !== null && count > 0) return "shared-kept";

  try {
    const result = await deletePhotoFiles(propertyId, key);
    if (!result.ok) {
      console.error("R2 photo cleanup pending:", result.code ?? "unknown");
      return "cleanup-pending";
    }
    return "deleted";
  } catch (storageErr) {
    console.error(
      "R2 photo cleanup pending:",
      storageErr instanceof MediaError ? storageErr.code : "unknown",
    );
    return "cleanup-pending";
  }
}

// 1. getUploadTicket — server-authorized presigned PUT; no storage secrets reach the browser.
export const getUploadTicket = createServerFn({ method: "POST" })
  .validator((data: unknown) => getUploadTicketSchema.parse(data))
  .handler(
    async ({
      data: { propertyId, contentType, byteSize },
    }): Promise<
      | {
          ok: true;
          data: {
            key: string;
            uploadUrl: string;
            method: string;
            headers: Record<string, string>;
            expiresAt: string;
            maxBytes: number;
          };
        }
      | {
          ok: false;
          error: string;
        }
    > => {
      try {
        await requireAdmin();
        await assertPropertyExists(propertyId);
        const ticket = await createPropertyUploadTicket(propertyId, contentType, byteSize);
        return {
          ok: true,
          data: {
            key: ticket.key,
            uploadUrl: ticket.uploadUrl,
            method: ticket.method,
            headers: ticket.headers,
            expiresAt: ticket.expiresAt,
            maxBytes: ticket.maxBytes,
          },
        };
      } catch (e) {
        console.error("Error in getUploadTicket:", logReason(e));
        return {
          ok: false,
          error: publicError(e, "Could not prepare the upload. Please try again."),
        };
      }
    },
  );

// 2. savePropertyPhoto — verifies the uploaded object, then persists it.
export const savePropertyPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => savePropertyPhotoSchema.parse(data))
  .handler(
    async ({
      data: { propertyId, key, mimeType, alt },
    }): Promise<
      | {
          ok: true;
          data: DBPhoto;
        }
      | {
          ok: false;
          error: string;
        }
    > => {
      let verifiedKey: string | null = null;
      let createdKeys: string[] = [];
      try {
        await requireAdmin();
        await assertPropertyExists(propertyId);

        // Ownership is decided from the key alone, so an object can only ever be
        // discarded when it sits inside this property's own namespace.
        const ownedKey = managedPropertyKey(key, propertyId);
        let verified: Awaited<ReturnType<typeof verifyPropertyUpload>>;
        try {
          verified = await verifyPropertyUpload(propertyId, key, mimeType);
        } catch (verifyError) {
          if (ownedKey && DISCARDABLE_UPLOAD_ERRORS.has(mediaCode(verifyError))) {
            await discardUploadedObject(propertyId, ownedKey);
          }
          throw verifyError;
        }
        verifiedKey = verified.key;

        // Optimise before touching the database: the original is copied to its
        // content-addressed key with a width marker, WebP variants are generated
        // beside it, and the temporary upload object is removed. A photo that
        // cannot be decoded is still saved (original only) so an odd encoder can
        // never block an upload; storage failures abort and stay retryable.
        let storedKey = verified.key;
        let storedUrl = verified.url;
        try {
          const object = await naplesMedia.getObject(verified.key, propertyMediaPrefix(propertyId));
          const stored = await storePhotoWithVariants({
            propertyId,
            buffer: object.body,
            mimeType: verified.mimeType,
          });
          storedKey = stored.original.key;
          storedUrl = stored.original.url;
          createdKeys = [
            ...(stored.original.reused ? [] : [stored.original.key]),
            ...stored.variants.filter((variant) => !variant.reused).map((variant) => variant.key),
          ];
          await deletePropertyObject(propertyId, verified.key);
          verifiedKey = null;
        } catch (optimizeError) {
          // Decoding failures are reported by the image pipeline with an IMAGE_
          // code; the upload is then saved without variants instead of failing.
          const optimizeCode = (optimizeError as { code?: unknown } | null)?.code;
          if (typeof optimizeCode !== "string" || !optimizeCode.startsWith("IMAGE_")) {
            throw optimizeError;
          }
          console.warn("Photo optimisation skipped:", optimizeCode);
        }

        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        const { data: photos, error: fetchError } = await supabaseAdmin
          .from("property_photos")
          .select("sort_order")
          .eq("property_id", propertyId);

        if (fetchError) {
          throw new PhotoRequestError("Could not check the existing photos. Please try again.");
        }

        let sortOrder = 1;
        let isCover = true;
        if (photos && photos.length > 0) {
          const maxSortOrder = Math.max(...photos.map((p) => p.sort_order || 0));
          sortOrder = maxSortOrder + 1;
          isCover = false;
        }

        if (!storedKey || !storedUrl) {
          throw new PhotoRequestError("Could not save the photo. Please try again.");
        }

        const { data: newPhoto, error: insertError } = await supabaseAdmin
          .from("property_photos")
          .insert({
            property_id: propertyId,
            storage_path: storedKey,
            public_url: storedUrl,
            alt: alt || "",
            sort_order: sortOrder,
            is_cover: isCover,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error inserting photo:", insertError);
          throw new PhotoRequestError("Could not save the photo. Please try again.");
        }

        return { ok: true, data: newPhoto as DBPhoto };
      } catch (e) {
        // The row was not created, so nothing on the site points at the object.
        if (verifiedKey) await discardUploadedObject(propertyId, verifiedKey);
        for (const createdKey of createdKeys) await deletePhotoFiles(propertyId, createdKey);
        console.error("Error in savePropertyPhoto:", logReason(e));
        return { ok: false, error: publicError(e, "Could not save the photo. Please try again.") };
      }
    },
  );

// 3. listPropertyPhotos — POST so the photo inventory is never a cacheable GET.
export const listPropertyPhotos = createServerFn({ method: "POST" })
  .validator((data: unknown) => listPropertyPhotosSchema.parse(data))
  .handler(async ({ data: { propertyId } }): Promise<DBPhoto[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("property_photos")
      .select("*")
      .eq("property_id", propertyId)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Error fetching property photos:", error);
      throw new Error("Could not load photos.");
    }

    return (data as DBPhoto[]) || [];
  });

// 4. deletePropertyPhoto
export const deletePropertyPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => deletePropertyPhotoSchema.parse(data))
  .handler(
    async ({
      data: { id },
    }): Promise<
      | {
          ok: true;
          storage: PhotoStorageOutcome;
        }
      | {
          ok: false;
          error: string;
        }
    > => {
      try {
        await requireAdmin();
        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        const { data: photo, error: fetchError } = await supabaseAdmin
          .from("property_photos")
          .select("storage_path, property_id, is_cover")
          .eq("id", id)
          .maybeSingle();

        if (fetchError) {
          console.error("Error loading photo for deletion:", fetchError);
          return { ok: false, error: "Could not delete the photo. Please try again." };
        }
        if (!photo) {
          return { ok: false, error: "Photo not found." };
        }

        const { error: deleteError } = await supabaseAdmin
          .from("property_photos")
          .delete()
          .eq("id", id);

        if (deleteError) {
          console.error("Error deleting photo from DB:", deleteError);
          return { ok: false, error: "Could not delete the photo. Please try again." };
        }

        const storage = await removeStoredFile(photo.storage_path, photo.property_id);

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
              const { error: updateError } = await supabaseAdmin
                .from("property_photos")
                .update({ is_cover: true })
                .eq("id", firstRemaining.id);
              if (updateError) {
                console.error("Error setting new cover photo:", updateError);
              }
            }
          }
        }

        return { ok: true, storage };
      } catch (e) {
        console.error("Error in deletePropertyPhoto:", logReason(e));
        return { ok: false, error: publicError(e, "Could not delete the photo.") };
      }
    },
  );

// 5. setCoverPhoto
export const setCoverPhoto = createServerFn({ method: "POST" })
  .validator((data: unknown) => setCoverPhotoSchema.parse(data))
  .handler(
    async ({
      data: { id, propertyId },
    }): Promise<
      | {
          ok: true;
        }
      | {
          ok: false;
          error: string;
        }
    > => {
      try {
        await requireAdmin();
        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        const { data: target, error: targetError } = await supabaseAdmin
          .from("property_photos")
          .select("id")
          .eq("id", id)
          .eq("property_id", propertyId)
          .maybeSingle();
        if (targetError) {
          console.error("Error checking cover photo target:", targetError);
          return { ok: false, error: "Could not set the cover photo. Please try again." };
        }
        if (!target) {
          return { ok: false, error: "Photo not found for this property." };
        }

        const { error: resetError } = await supabaseAdmin
          .from("property_photos")
          .update({ is_cover: false })
          .eq("property_id", propertyId);

        if (resetError) {
          console.error("Error resetting cover photos:", resetError);
          return { ok: false, error: "Could not set the cover photo. Please try again." };
        }

        const { error: setError } = await supabaseAdmin
          .from("property_photos")
          .update({ is_cover: true })
          .eq("id", id)
          .eq("property_id", propertyId);

        if (setError) {
          console.error("Error setting cover photo:", setError);
          return { ok: false, error: "Could not set the cover photo. Please try again." };
        }

        return { ok: true };
      } catch (e) {
        console.error("Error in setCoverPhoto:", logReason(e));
        return { ok: false, error: publicError(e, "Could not set the cover photo.") };
      }
    },
  );

// 6. reorderPhotos
export const reorderPhotos = createServerFn({ method: "POST" })
  .validator((data: unknown) => reorderPhotosSchema.parse(data))
  .handler(
    async ({
      data: { propertyId, orderedIds },
    }): Promise<
      | {
          ok: true;
        }
      | {
          ok: false;
          error: string;
        }
    > => {
      try {
        await requireAdmin();
        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

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
            return { ok: false, error: "Could not reorder the photos. Please try again." };
          }
        }

        return { ok: true };
      } catch (e) {
        console.error("Error in reorderPhotos:", logReason(e));
        return { ok: false, error: publicError(e, "Could not reorder the photos.") };
      }
    },
  );
