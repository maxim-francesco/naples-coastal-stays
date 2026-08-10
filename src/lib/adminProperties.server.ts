import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./authGuard.server";

export interface DBProperty {
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
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export const propertySchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  name: z.string().min(1),
  area: z.string().min(1),
  short_description: z.string().min(1),
  long_description: z.array(z.string()),
  max_guests: z.number().int().min(1),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  min_nights: z.number().int().min(1),
  base_rate: z.number().min(0),
  cleaning_fee: z.number().min(0),
  amenities: z.array(z.string()),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});

export const createPropertySchema = propertySchema.extend({
  accessToken: z.string().optional(),
});

export const updatePropertySchema = z.object({
  id: z.string().min(1),
  input: propertySchema,
  accessToken: z.string().optional(),
});

export const deletePropertySchema = z.object({
  id: z.string().min(1),
  accessToken: z.string().optional(),
});

// Fetch all properties (active + inactive) ordered by sort_order
export const listAllPropertiesAdmin = createServerFn({ method: "GET" })
  .handler(async (): Promise<DBProperty[]> => {
    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
    const { data, error } = await supabaseAdmin
      .from("properties")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Error fetching all properties for admin:", error);
      throw new Error(`Failed to fetch admin properties: ${error.message}`);
    }

    return (data as DBProperty[]) || [];
  });

// Create a new property
export const createProperty = createServerFn({ method: "POST" })
  .validator((data: unknown) => createPropertySchema.parse(data))
  .handler(async ({ data: { accessToken, ...input } }): Promise<{ ok: true; data: DBProperty } | { ok: false; error: string }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Check if slug already exists
      const { data: existing } = await supabaseAdmin
        .from("properties")
        .select("id")
        .eq("slug", input.slug)
        .maybeSingle();

      if (existing) {
        return { ok: false, error: `A property with slug "${input.slug}" already exists.` };
      }

      const { data, error } = await (supabaseAdmin.from("properties") as any)
        .insert(input)
        .select()
        .single();

      if (error) {
        console.error("Error creating property:", error);
        return { ok: false, error: error.message };
      }

      return { ok: true, data: data as DBProperty };
    } catch (e: any) {
      console.error("Unexpected error in createProperty:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// Update an existing property
export const updateProperty = createServerFn({ method: "POST" })
  .validator((data: unknown) => updatePropertySchema.parse(data))
  .handler(async ({ data: { id, input, accessToken } }): Promise<{ ok: true; data: DBProperty } | { ok: false; error: string }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      // Check if slug already exists for another property
      const { data: existing } = await supabaseAdmin
        .from("properties")
        .select("id")
        .eq("slug", input.slug)
        .neq("id", id)
        .maybeSingle();

      if (existing) {
        return { ok: false, error: `A property with slug "${input.slug}" already exists.` };
      }

      const { data, error } = await (supabaseAdmin.from("properties") as any)
        .update(input)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Error updating property:", error);
        return { ok: false, error: error.message };
      }

      return { ok: true, data: data as DBProperty };
    } catch (e: any) {
      console.error("Unexpected error in updateProperty:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

// Delete a property
export const deleteProperty = createServerFn({ method: "POST" })
  .validator((data: unknown) => deletePropertySchema.parse(data))
  .handler(async ({ data: { id, accessToken } }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await requireAdmin(accessToken);
      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      const { error } = await supabaseAdmin
        .from("properties")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting property:", error);
        return { ok: false, error: error.message };
      }

      return { ok: true };
    } catch (e: any) {
      console.error("Unexpected error in deleteProperty:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });
