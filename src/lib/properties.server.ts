import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { propertyAssets } from "@/data/propertyAssets";

export interface Property {
  id: string;
  slug: string;
  name: string;
  area: string;
  shortDescription: string;
  longDescription: string[];
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  minNights: number;
  baseRate: number;
  cleaningFee: number;
  amenities: string[];
  photos: { src: string; alt: string }[];
  blackoutDates: { from: string; to: string }[];
}

const mapDBPhotoToUIPhoto = (row: any) => ({
  src: row.public_url,
  alt: row.alt || "",
});

const mapRowToProperty = (row: any, dbPhotos: any[]): Property => {
  const assets = propertyAssets[row.slug] || { photos: [], blackoutDates: [] };
  const photos = dbPhotos && dbPhotos.length > 0
    ? dbPhotos.map(mapDBPhotoToUIPhoto)
    : assets.photos;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    area: row.area,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    maxGuests: row.max_guests,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    minNights: row.min_nights,
    baseRate: row.base_rate,
    cleaningFee: row.cleaning_fee,
    amenities: row.amenities,
    photos,
    blackoutDates: assets.blackoutDates,
  };
};

export const getActiveProperties = createServerFn({ method: "GET" })
  .handler(async (): Promise<Property[]> => {
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch active properties: ${error.message}`);
    }

    if (!data) return [];

    let photosByPropertyId: Record<string, any[]> = {};
    if (data.length > 0) {
      const ids = data.map((p) => p.id);
      const { data: photosData, error: photosError } = await supabaseAdmin
        .from("property_photos")
        .select("property_id, public_url, alt, is_cover, sort_order")
        .in("property_id", ids)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true });

      if (photosError) {
        throw new Error(`Failed to fetch property photos: ${photosError.message}`);
      }

      if (photosData) {
        for (const photo of photosData) {
          const propId = photo.property_id;
          if (!photosByPropertyId[propId]) {
            photosByPropertyId[propId] = [];
          }
          photosByPropertyId[propId]!.push(photo);
        }
      }
    }

    return data.map((row) => mapRowToProperty(row, photosByPropertyId[row.id] || []));
  });

export const getPropertyBySlug = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<Property | null> => {
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new Error(`Failed to fetch property by slug: ${error.message}`);
    }

    if (!data) return null;

    const { data: photosData, error: photosError } = await supabaseAdmin
      .from("property_photos")
      .select("property_id, public_url, alt, is_cover, sort_order")
      .eq("property_id", data.id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });

    if (photosError) {
      throw new Error(`Failed to fetch property photos: ${photosError.message}`);
    }

    return mapRowToProperty(data, photosData || []);
  });
