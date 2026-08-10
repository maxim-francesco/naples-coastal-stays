import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { propertyAssets } from "@/data/propertyAssets";

export interface Property {
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

const mapRowToProperty = (row: any): Property => {
  const assets = propertyAssets[row.slug] || { photos: [], blackoutDates: [] };
  return {
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
    photos: assets.photos,
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
    return data.map(mapRowToProperty);
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
    return mapRowToProperty(data);
  });
