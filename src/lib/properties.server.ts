import { createServerFn } from "@tanstack/react-start";
import {
  blockingRanges,
  normalizeAvailabilityRange,
  todayInTimeZone,
  type AvailabilityRange,
} from "./availability";

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
  photos: { src: string; alt: string; isCover?: boolean; isHero?: boolean }[];
  /** Confirmed reservations plus manual blackouts, as [start, end) ranges. */
  unavailableDates: AvailabilityRange[];
}

interface DBPhotoRow {
  property_id?: string;
  public_url: string;
  alt?: string | null;
  is_cover?: boolean | null;
  is_hero?: boolean | null;
}

interface DBPropertyRow {
  id: string;
  slug: string;
  name: string;
  area: string;
  short_description: string;
  long_description: string[];
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  min_nights: number;
  base_rate: number;
  cleaning_fee: number;
  amenities: string[];
}

const mapDBPhotoToUIPhoto = (row: DBPhotoRow) => ({
  src: row.public_url,
  alt: row.alt || "",
  isCover: !!row.is_cover,
  isHero: !!row.is_hero,
});

const mapRowToProperty = (
  row: DBPropertyRow,
  dbPhotos: DBPhotoRow[],
  unavailableDates: AvailabilityRange[] = [],
): Property => {
  const photos = dbPhotos && dbPhotos.length > 0 ? dbPhotos.map(mapDBPhotoToUIPhoto) : [];
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
    unavailableDates,
  };
};

async function loadUnavailableRanges(propertyId: string): Promise<AvailabilityRange[]> {
  const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
  const [blackoutsResult, reservationsResult] = await Promise.all([
    supabaseAdmin
      .from("blackout_dates")
      .select("start_date, end_date")
      .eq("property_id", propertyId),
    supabaseAdmin
      .from("booking_requests")
      .select("check_in, check_out, status")
      .eq("property_id", propertyId)
      .eq("status", "confirmed"),
  ]);

  if (blackoutsResult.error || reservationsResult.error) {
    console.error("Error fetching property availability:", {
      blackouts: blackoutsResult.error,
      reservations: reservationsResult.error,
    });
    throw new Error("Failed to fetch property availability.");
  }

  const blackouts = (blackoutsResult.data ?? [])
    .map((row) => normalizeAvailabilityRange({ start: row.start_date, end: row.end_date }))
    .filter((range): range is AvailabilityRange => range !== null);
  const reservations = (reservationsResult.data ?? []).map((row) => ({
    checkIn: row.check_in,
    checkOut: row.check_out,
    status: row.status,
  }));

  return blockingRanges({ blackouts, bookings: reservations });
}

export const getActiveProperties = createServerFn({ method: "GET" }).handler(
  async (): Promise<Property[]> => {
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

    const photosByPropertyId: Record<string, DBPhotoRow[]> = {};
    if (data.length > 0) {
      const ids = data.map((p) => p.id);
      const { data: photosData, error: photosError } = await supabaseAdmin
        .from("property_photos")
        .select("property_id, public_url, alt, is_cover, is_hero, sort_order")
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
  },
);

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
      .select("property_id, public_url, alt, is_cover, is_hero, sort_order")
      .eq("property_id", data.id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });

    if (photosError) {
      throw new Error(`Failed to fetch property photos: ${photosError.message}`);
    }

    return mapRowToProperty(data, photosData || [], await loadUnavailableRanges(data.id));
  });

interface PublicAvailability {
  propertyId: string;
  today: string;
  unavailableDates: AvailabilityRange[];
}

// Only ranges leave this endpoint: no guest names, emails, messages or admin
// fields. The public calendar can refresh its dates without exposing bookings.
export const getPropertyAvailability = createServerFn({ method: "POST" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<PublicAvailability | null> => {
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("id")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("Error loading property availability:", error);
      throw new Error("Could not check availability.");
    }
    if (!data) return null;

    return {
      propertyId: data.id,
      today: todayInTimeZone(),
      unavailableDates: await loadUnavailableRanges(data.id),
    };
  });
