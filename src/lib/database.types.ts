export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string
          slug: string
          name: string
          area: string
          short_description: string
          long_description: string[]
          max_guests: number
          bedrooms: number
          bathrooms: number
          min_nights: number
          base_rate: number
          cleaning_fee: number
          amenities: string[]
          sort_order: number
          is_active: boolean
          created_at?: string
          updated_at?: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          area: string
          short_description: string
          long_description: string[]
          max_guests: number
          bedrooms: number
          bathrooms: number
          min_nights: number
          base_rate: number
          cleaning_fee: number
          amenities: string[]
          sort_order: number
          is_active: boolean
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          area?: string
          short_description?: string
          long_description?: string[]
          max_guests?: number
          bedrooms?: number
          bathrooms?: number
          min_nights?: number
          base_rate?: number
          cleaning_fee?: number
          amenities?: string[]
          sort_order?: number
          is_active?: boolean
        }
        Relationships: []
      }
      property_photos: {
        Row: {
          id: string
          property_id: string
          storage_path: string | null
          public_url: string
          alt: string
          sort_order: number
          is_cover: boolean
          created_at?: string
        }
        Insert: {
          id?: string
          property_id: string
          storage_path: string | null
          public_url: string
          alt: string
          sort_order: number
          is_cover: boolean
        }
        Update: {
          id?: string
          property_id?: string
          storage_path?: string | null
          public_url?: string
          alt?: string
          sort_order?: number
          is_cover?: boolean
        }
        Relationships: []
      }
      rate_periods: {
        Row: {
          id: string
          property_id: string
          label: string
          start_date: string
          end_date: string
          nightly_rate: number
          created_at?: string
        }
        Insert: {
          id?: string
          property_id: string
          label: string
          start_date: string
          end_date: string
          nightly_rate: number
        }
        Update: {
          id?: string
          property_id?: string
          label?: string
          start_date?: string
          end_date?: string
          nightly_rate?: number
        }
        Relationships: []
      }
      blackout_dates: {
        Row: {
          id: string
          property_id: string
          start_date: string
          end_date: string
          note: string
          created_at?: string
        }
        Insert: {
          id?: string
          property_id: string
          start_date: string
          end_date: string
          note: string
        }
        Update: {
          id?: string
          property_id?: string
          start_date?: string
          end_date?: string
          note?: string
        }
        Relationships: []
      }
      booking_requests: {
        Row: {
          id: string
          property_id: string | null
          guest_name: string
          email: string
          check_in: string
          check_out: string
          guests: number
          message: string
          status: string
          ip_hash: string | null
          created_at?: string
        }
        Insert: {
          id?: string
          property_id?: string | null
          guest_name: string
          email: string
          check_in: string
          check_out: string
          guests: number
          message: string
          status: string
          ip_hash?: string | null
        }
        Update: {
          id?: string
          property_id?: string | null
          guest_name?: string
          email?: string
          check_in?: string
          check_out?: string
          guests?: number
          message?: string
          status?: string
          ip_hash?: string | null
        }
        Relationships: []
      }
      booking_submits: {
        Row: {
          id: string
          ip_hash: string
          created_at?: string
        }
        Insert: {
          id?: string
          ip_hash: string
        }
        Update: {
          id?: string
          ip_hash?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
