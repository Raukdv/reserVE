/**
 * Tipos del esquema de Supabase.
 *
 * Escritos a mano a partir de supabase/migrations/0001_init.sql, porque
 * `supabase gen types --db-url` necesita Docker para levantar postgres-meta.
 * Cuando tengas la CLI enlazada (`supabase link`), regenéralos con:
 *
 *     npm run db:types
 *
 * Si cambias una migración, actualiza este archivo en el mismo commit.
 */

import type { AppliedFee } from '@/lib/fees'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type UserRole = 'admin' | 'staff' | 'guest'
export type HoldKind = 'booking' | 'block'
export type BookingStatus =
  | 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'expired'
export type PaymentKind = 'deposit' | 'balance' | 'refund'
export type PaymentStatus = 'pending' | 'verifying' | 'approved' | 'rejected' | 'refunded'
export type PaymentMethod =
  | 'pago_movil' | 'c2p' | 'transferencia' | 'zelle' | 'binance'
  | 'paypal' | 'usdt' | 'tarjeta' | 'efectivo'

/**
 * Mercado de la tasa.
 *
 * Solo `oficial` puede usarse para cobrar: la Ley de Precios Justos obliga a
 * operar a la tasa del BCV. `paralelo` existe únicamente para medir la brecha
 * y ayudar a fijar el precio de lista en USD.
 */
export type FeeKind = 'fixed' | 'per_night' | 'per_guest' | 'percent'

export type RateMarket = 'oficial' | 'paralelo'

export type EmailKind =
  | 'booking_created'
  | 'payment_received'
  | 'payment_approved'
  | 'payment_rejected'
  | 'arrival_reminder'

/** Resultado de la función quote_stay(). */
export type Quote =
  | { ok: false; error: string; min_nights?: number; max_nights?: number }
  | {
      ok: true
      nights: number
      subtotal_usd: number
      /** Desglose de cargos aplicados a esta estadía. */
      fees: AppliedFee[]
      fees_usd: number
      total_usd: number
      rate: number
      /** Fecha valor de la tasa aplicada. El monto en Bs vale mientras coincida. */
      rate_date: string
      total_ves: number
      deposit_ratio: number
      deposit_usd: number
    }

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          role: UserRole
          full_name: string | null
          phone: string | null
          document_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          role?: UserRole
          full_name?: string | null
          phone?: string | null
          document_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }

      properties: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          address: string | null
          city: string | null
          latitude: number | null
          longitude: number | null
          timezone: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          address?: string | null
          city?: string | null
          latitude?: number | null
          longitude?: number | null
          timezone?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['properties']['Insert']>
        Relationships: []
      }

      units: {
        Row: {
          id: string
          property_id: string
          name: string
          slug: string
          description: string | null
          max_guests: number
          bedrooms: number
          beds: number
          bathrooms: number
          base_price_usd: number
          min_nights: number
          max_nights: number | null
          advance_notice_days: number
          is_published: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          property_id: string
          name: string
          slug: string
          description?: string | null
          max_guests?: number
          bedrooms?: number
          beds?: number
          bathrooms?: number
          base_price_usd: number
          min_nights?: number
          max_nights?: number | null
          advance_notice_days?: number
          is_published?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['units']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'units_property_id_fkey'
            columns: ['property_id']
            isOneToOne: false
            referencedRelation: 'properties'
            referencedColumns: ['id']
          },
        ]
      }

      unit_media: {
        Row: {
          id: string
          unit_id: string
          storage_path: string
          alt_text: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          storage_path: string
          alt_text?: string | null
          sort_order?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['unit_media']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'unit_media_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
        ]
      }

      amenities: {
        Row: {
          id: string
          slug: string
          label: string
          /** Nombre del icono en lucide-react. Ver src/lib/amenities.ts. */
          icon: string | null
          category: string
          sort_order: number
        }
        Insert: {
          id?: string
          slug: string
          label: string
          icon?: string | null
          category?: string
          sort_order?: number
        }
        Update: Partial<Database['public']['Tables']['amenities']['Insert']>
        Relationships: []
      }

      // Las relaciones declaradas aquí son lo que permite a PostgREST inferir
      // los embeds — `select('unit_amenities(amenities(label))')` y similares.
      // Sin ellas el tipo del embed resuelve a SelectQueryError.
      unit_amenities: {
        Row: { unit_id: string; amenity_id: string }
        Insert: { unit_id: string; amenity_id: string }
        Update: Partial<Database['public']['Tables']['unit_amenities']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'unit_amenities_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'unit_amenities_amenity_id_fkey'
            columns: ['amenity_id']
            isOneToOne: false
            referencedRelation: 'amenities'
            referencedColumns: ['id']
          },
        ]
      }

      season_rates: {
        Row: {
          id: string
          unit_id: string
          name: string
          /** daterange serializado, p. ej. "[2026-12-15,2027-01-08)" */
          period: string
          price_usd: number
          min_nights: number | null
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          name: string
          period: string
          price_usd: number
          min_nights?: number | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['season_rates']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'season_rates_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
        ]
      }

      unit_holds: {
        Row: {
          id: string
          unit_id: string
          /** daterange semiabierto "[check_in,check_out)" */
          stay: string
          kind: HoldKind
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          stay: string
          kind: HoldKind
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['unit_holds']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'unit_holds_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
        ]
      }

      availability_blocks: {
        Row: {
          id: string
          hold_id: string
          reason: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          hold_id: string
          reason?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['availability_blocks']['Insert']>
        Relationships: [
          {
            // hold_id es UNIQUE: un bloqueo ocupa exactamente un hold.
            foreignKeyName: 'availability_blocks_hold_id_fkey'
            columns: ['hold_id']
            isOneToOne: true
            referencedRelation: 'unit_holds'
            referencedColumns: ['id']
          },
        ]
      }

      exchange_rates: {
        Row: {
          /** Fecha valor: el día para el que rige la tasa, según el BCV. */
          rate_date: string
          /** oficial = única legal para cobrar. paralelo = solo métrica de brecha. */
          market: RateMarket
          usd_ves: number
          /** Proveedor del dato, distinto del mercado. */
          source: string
          fetched_at: string
        }
        Insert: {
          rate_date: string
          market?: RateMarket
          usd_ves: number
          source?: string
          fetched_at?: string
        }
        Update: Partial<Database['public']['Tables']['exchange_rates']['Insert']>
        Relationships: []
      }

      email_log: {
        Row: {
          id: number
          sent_at: string
          kind: EmailKind
          recipient: string
          booking_id: string | null
          ok: boolean
          provider_id: string | null
          detail: string | null
        }
        Insert: {
          id?: number
          sent_at?: string
          kind: EmailKind
          recipient: string
          booking_id?: string | null
          ok: boolean
          provider_id?: string | null
          detail?: string | null
        }
        Update: Partial<Database['public']['Tables']['email_log']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'email_log_booking_id_fkey'
            columns: ['booking_id']
            isOneToOne: false
            referencedRelation: 'bookings'
            referencedColumns: ['id']
          },
        ]
      }

      rate_fetch_log: {
        Row: {
          id: number
          ran_at: string
          ok: boolean
          rate_date: string | null
          usd_ves: number | null
          source: string | null
          detail: string | null
        }
        Insert: {
          id?: number
          ran_at?: string
          ok: boolean
          rate_date?: string | null
          usd_ves?: number | null
          source?: string | null
          detail?: string | null
        }
        Update: Partial<Database['public']['Tables']['rate_fetch_log']['Insert']>
        Relationships: []
      }

      bookings: {
        Row: {
          id: string
          code: string
          unit_id: string
          hold_id: string
          guest_id: string | null
          status: BookingStatus
          check_in: string
          check_out: string
          /** Columna generada: check_out - check_in. Solo lectura. */
          nights: number
          guests: number
          guest_name: string
          /** Null en reservas tomadas por teléfono. El formulario público sí lo exige. */
          guest_email: string | null
          guest_phone: string | null
          guest_document: string | null
          notes: string | null
          subtotal_usd: number
          discount_usd: number
          total_usd: number
          fees_usd: number
          /** Desglose congelado de cargos tal como se aplicaron. */
          fees_breakdown: Json
          rate_snapshot: number
          /** Fecha valor de rate_snapshot. Si deja de ser la vigente, se recotiza. */
          rate_date: string | null
          total_ves: number
          igtf_ves: number
          deposit_ratio: number
          expires_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          /** Lo que la política obligaba a devolver al cancelar. Congelado; ver 0023. */
          refund_due_usd: number | null
          /** Quién confirmó sin cubrir el anticipo. Null en las confirmadas por pago. */
          manual_confirmation_by: string | null
          manual_confirmation_reason: string | null
          manual_confirmation_at: string | null
          checked_in_at: string | null
          checked_out_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code?: string
          unit_id: string
          hold_id: string
          guest_id?: string | null
          status?: BookingStatus
          check_in: string
          check_out: string
          guests?: number
          guest_name: string
          guest_email?: string | null
          guest_phone?: string | null
          guest_document?: string | null
          notes?: string | null
          subtotal_usd: number
          discount_usd?: number
          total_usd: number
          fees_usd?: number
          fees_breakdown?: Json
          rate_snapshot: number
          rate_date?: string | null
          total_ves: number
          igtf_ves?: number
          deposit_ratio?: number
          expires_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
          refund_due_usd?: number | null
          manual_confirmation_by?: string | null
          manual_confirmation_reason?: string | null
          manual_confirmation_at?: string | null
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['bookings']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'bookings_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
          {
            // hold_id es UNIQUE: una reserva ocupa exactamente un hold.
            foreignKeyName: 'bookings_hold_id_fkey'
            columns: ['hold_id']
            isOneToOne: true
            referencedRelation: 'unit_holds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_guest_id_fkey'
            columns: ['guest_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }

      payments: {
        Row: {
          id: string
          booking_id: string
          kind: PaymentKind
          method: PaymentMethod
          status: PaymentStatus
          currency: 'USD' | 'VES'
          amount: number
          amount_usd: number
          rate_used: number | null
          origin: string | null
          reference: string | null
          paid_at: string | null
          receipt_path: string | null
          payer_name: string | null
          payer_document: string | null
          payer_bank: string | null
          /** Pasarela que procesó el cobro. Null en pagos reportados a mano. */
          provider: string | null
          /** Identificador del cobro en la pasarela. Hace idempotente el webhook. */
          provider_ref: string | null
          gateway_payload: Json | null
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          admin_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          booking_id: string
          kind?: PaymentKind
          method: PaymentMethod
          status?: PaymentStatus
          currency: 'USD' | 'VES'
          amount: number
          amount_usd: number
          rate_used?: number | null
          origin?: string | null
          reference?: string | null
          paid_at?: string | null
          receipt_path?: string | null
          payer_name?: string | null
          payer_document?: string | null
          payer_bank?: string | null
          provider?: string | null
          provider_ref?: string | null
          gateway_payload?: Json | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          admin_notes?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['payments']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'payments_booking_id_fkey'
            columns: ['booking_id']
            isOneToOne: false
            referencedRelation: 'bookings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }

      payment_accounts: {
        Row: {
          id: string
          method: PaymentMethod
          label: string
          holder: string | null
          document: string | null
          bank: string | null
          /** Teléfono, correo, usuario, wallet o número de cuenta al que se paga. */
          identifier: string
          instructions: string | null
          is_active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          method: PaymentMethod
          label: string
          holder?: string | null
          document?: string | null
          bank?: string | null
          identifier: string
          instructions?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['payment_accounts']['Insert']>
        Relationships: []
      }

      fees: {
        Row: {
          id: string
          /** Null = cargo general, se aplica a todas las unidades. */
          unit_id: string | null
          name: string
          kind: FeeKind
          /** Monto en USD, o porcentaje si kind = percent. */
          amount: number
          description: string | null
          refundable: boolean
          is_active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          unit_id?: string | null
          name: string
          kind: FeeKind
          amount: number
          description?: string | null
          refundable?: boolean
          is_active?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fees']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'fees_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
        ]
      }

      site_content: {
        Row: { key: string; data: Json; updated_by: string | null; updated_at: string }
        Insert: { key: string; data?: Json; updated_by?: string | null; updated_at?: string }
        Update: Partial<Database['public']['Tables']['site_content']['Insert']>
        Relationships: []
      }

      app_settings: {
        Row: {
          id: boolean
          business_name: string
          business_email: string | null
          business_phone: string | null
          currency_display: 'usd' | 'ves' | 'both'
          default_deposit_ratio: number
          pending_ttl_hours: number
          igtf_enabled: boolean
          igtf_rate: number
          /** Título de /legal/cancelacion. Vacío usa el genérico. */
          cancellation_title: string | null
          /** Texto de apoyo. Acompaña a los tramos; no los sustituye. */
          cancellation_policy: string | null
          /** Escalera de reembolso: [{hours_before, refund_percent}]. */
          cancellation_tiers: Json
          /** Hora local de llegada. Los plazos de cancelación se miden desde aquí. */
          check_in_time: string
          check_out_time: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          business_name?: string
          business_email?: string | null
          business_phone?: string | null
          currency_display?: 'usd' | 'ves' | 'both'
          default_deposit_ratio?: number
          pending_ttl_hours?: number
          igtf_enabled?: boolean
          igtf_rate?: number
          cancellation_title?: string | null
          cancellation_policy?: string | null
          cancellation_tiers?: Json
          check_in_time?: string
          check_out_time?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>
        Relationships: []
      }
    }

    Views: {
      /** Una fila por unidad: su foto de portada. Ver 0022. */
      unit_covers: {
        Row: {
          unit_id: string
          storage_path: string
          alt_text: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'unit_media_unit_id_fkey'
            columns: ['unit_id']
            isOneToOne: false
            referencedRelation: 'units'
            referencedColumns: ['id']
          },
        ]
      }
    }

    Functions: {
      current_rate: { Args: Record<string, never>; Returns: number }
      current_rate_date: { Args: Record<string, never>; Returns: string }
      rate_is_stale: { Args: Record<string, never>; Returns: boolean }
      /** Brecha del paralelo sobre el oficial, en fracción. Solo observabilidad. */
      current_gap: { Args: Record<string, never>; Returns: number }
      business_today: { Args: Record<string, never>; Returns: string }
      is_staff: { Args: Record<string, never>; Returns: boolean }
      expire_stale_bookings: { Args: Record<string, never>; Returns: number }
      prune_rate_fetch_log: { Args: Record<string, never>; Returns: undefined }
      prune_email_log: { Args: Record<string, never>; Returns: undefined }
      bookings_arriving_tomorrow: {
        Args: Record<string, never>
        Returns: {
          id: string
          code: string
          guest_name: string
          guest_email: string
          unit_name: string
          check_in: string
          check_out: string
          nights: number
          total_usd: number
          paid_usd: number
        }[]
      }
      is_available: {
        Args: { p_unit_id: string; p_check_in: string; p_check_out: string }
        Returns: boolean
      }
      quote_stay: {
        Args: {
          p_unit_id: string
          p_check_in: string
          p_check_out: string
          p_guests?: number
          /** Solo el operador: permite cerrar para hoy y saltar el mínimo de noches. */
          p_skip_notice?: boolean
        }
        Returns: Quote
      }
      staff_create_booking: {
        Args: {
          p_unit_id: string
          p_check_in: string
          p_check_out: string
          p_guests: number
          p_guest_name: string
          p_guest_email?: string | null
          p_guest_phone?: string | null
          p_guest_document?: string | null
          p_notes?: string | null
          p_discount_usd?: number
        }
        Returns: Json
      }
      create_booking: {
        Args: {
          p_unit_id: string
          p_check_in: string
          p_check_out: string
          p_guests: number
          p_guest_name: string
          p_guest_email: string
          p_guest_phone?: string | null
          p_guest_document?: string | null
          p_notes?: string | null
        }
        Returns: Json
      }
      get_booking: { Args: { p_code: string }; Returns: Json }
      report_payment: {
        Args: {
          p_code: string
          p_method: PaymentMethod
          p_currency: string
          p_amount: number
          p_origin?: string | null
          p_reference?: string | null
          p_paid_at?: string | null
          p_receipt_path?: string | null
          p_payer_name?: string | null
          p_payer_document?: string | null
        }
        Returns: Json
      }
      refresh_booking_rate: { Args: { p_code: string }; Returns: Json }
      compute_fees: {
        Args: { p_unit_id: string; p_nights: number; p_guests: number; p_subtotal: number }
        Returns: Json
      }
      night_price: { Args: { p_unit_id: string; p_night: string }; Returns: number }
      cancellation_quote: { Args: { p_code: string }; Returns: Json }
      create_block: {
        Args: { p_unit_id: string; p_from: string; p_to: string; p_reason?: string | null }
        Returns: Json
      }
      release_block: { Args: { p_hold_id: string }; Returns: Json }
      settle_booking: { Args: { p_booking_id: string }; Returns: Json }
      staff_record_payment: {
        Args: {
          p_code: string
          p_method: PaymentMethod
          p_currency: string
          p_amount: number
          p_reference?: string | null
          p_notes?: string | null
        }
        Returns: Json
      }
      staff_confirm_booking: { Args: { p_code: string; p_reason: string }; Returns: Json }
      staff_delete_unit: { Args: { p_unit_id: string }; Returns: Json }
      staff_delete_amenity: {
        Args: { p_id: string; p_force?: boolean }
        Returns: Json
      }
      staff_check_in: { Args: { p_code: string }; Returns: Json }
      staff_check_out: { Args: { p_code: string; p_force?: boolean }; Returns: Json }
      staff_cancel_booking: { Args: { p_code: string; p_reason: string | null }; Returns: Json }
      staff_record_refund: {
        Args: {
          p_code: string
          p_method: PaymentMethod
          p_currency: string
          p_amount: number
          p_reference?: string | null
          p_paid_at?: string | null
          p_notes?: string | null
        }
        Returns: Json
      }
      record_gateway_payment: {
        Args: {
          p_code: string
          p_provider: string
          p_provider_ref: string
          p_method: PaymentMethod
          p_currency: string
          p_amount: number
          p_amount_usd: number
          p_payload?: Json | null
        }
        Returns: Json
      }
    }

    Enums: {
      user_role: UserRole
      email_kind: EmailKind
      fee_kind: FeeKind
      hold_kind: HoldKind
      booking_status: BookingStatus
      payment_kind: PaymentKind
      payment_status: PaymentStatus
      payment_method: PaymentMethod
    }

    CompositeTypes: Record<string, never>
  }
}

type PublicTables = Database['public']['Tables']
export type Row<T extends keyof PublicTables> = PublicTables[T]['Row']
export type Insert<T extends keyof PublicTables> = PublicTables[T]['Insert']
export type Update<T extends keyof PublicTables> = PublicTables[T]['Update']
