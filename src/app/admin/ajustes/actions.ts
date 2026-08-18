'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
import { loadBookingEmail, sendBookingCreated } from '@/lib/email'
import type { PaymentMethod } from '@/types/database'
import { GUEST_METHODS } from '@/lib/payment-methods'
import { documentError } from '@/lib/document'

export type SettingsState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
  return profile
}

// ---------------------------------------------------------------------------
// Datos del negocio y condiciones de cobro
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  businessName: z.string().trim().min(2, 'Escribe el nombre del negocio').max(120),
  businessEmail: z.string().trim().email('Revisa el correo').or(z.literal('')),
  businessPhone: z.string().trim().max(40).or(z.literal('')),
  currencyDisplay: z.enum(['usd', 'ves', 'both']),
  depositRatio: z.coerce
    .number()
    .min(1, 'El anticipo mínimo es 1%')
    .max(100, 'El anticipo máximo es 100%'),
  pendingTtlHours: z.coerce
    .number()
    .int()
    .min(1, 'Mínimo 1 hora')
    .max(720, 'Máximo 30 días'),
  cancellationTitle: z.string().trim().max(120).or(z.literal('')),
  cancellationPolicy: z.string().trim().max(2000).or(z.literal('')),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/, 'Revisa la hora de entrada'),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Revisa la hora de salida'),
  // Llega como JSON desde el editor de tramos.
  cancellationTiers: z
    .string()
    .transform((raw, ctx) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Tramos de cancelación no válidos' })
        return z.NEVER
      }
      /*
        Los dos tipos de tramo, cada uno con su campo. Estuvo escrito como un
        solo objeto que exigía `refund_percent` siempre, y eso hacía imposible
        guardar un tramo por noches: el campo llegaba vacío, el esquema fallaba
        y el operador solo veía «revisa los tramos». Sin discriminar por `kind`,
        además, zod descartaba `forfeit_nights` por no estar declarado y el
        tramo se guardaba sin la cifra que lo define.
      */
      const tiers = z
        .array(
          z.discriminatedUnion('kind', [
            z.object({
              hours_before: z.coerce.number().int().min(0).max(8760),
              kind: z.literal('percent'),
              refund_percent: z.coerce.number().int().min(0).max(100),
            }),
            z.object({
              hours_before: z.coerce.number().int().min(0).max(8760),
              kind: z.literal('nights'),
              forfeit_nights: z.coerce.number().int().min(1).max(30),
            }),
          ]),
        )
        .safeParse(parsed)

      if (!tiers.success) {
        ctx.addIssue({ code: 'custom', message: 'Revisa los tramos de cancelación' })
        return z.NEVER
      }
      // De mayor a menor antelación: es el orden en que se evalúan.
      return [...tiers.data].sort((a, b) => b.hours_before - a.hours_before)
    }),
  igtfEnabled: z.coerce.boolean(),
  igtfRate: z.coerce.number().min(0).max(20),
})

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireStaff()

  const parsed = settingsSchema.safeParse({
    businessName: formData.get('businessName'),
    businessEmail: formData.get('businessEmail') ?? '',
    businessPhone: formData.get('businessPhone') ?? '',
    currencyDisplay: formData.get('currencyDisplay'),
    depositRatio: formData.get('depositRatio'),
    pendingTtlHours: formData.get('pendingTtlHours'),
    cancellationTitle: formData.get('cancellationTitle') ?? '',
    cancellationPolicy: formData.get('cancellationPolicy') ?? '',
    checkInTime: formData.get('checkInTime'),
    checkOutTime: formData.get('checkOutTime'),
    cancellationTiers: formData.get('cancellationTiers') ?? '[]',
    igtfEnabled: formData.get('igtfEnabled') === 'on',
    igtfRate: formData.get('igtfRate'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const { error } = await supabase
    .from('app_settings')
    .update({
      business_name: d.businessName,
      business_email: d.businessEmail || null,
      business_phone: d.businessPhone || null,
      currency_display: d.currencyDisplay,
      // En la interfaz se maneja en porcentaje porque es como lo piensa el
      // operador; en la base es una fracción.
      default_deposit_ratio: d.depositRatio / 100,
      pending_ttl_hours: d.pendingTtlHours,
      cancellation_title: d.cancellationTitle || null,
      cancellation_policy: d.cancellationPolicy || null,
      cancellation_tiers: d.cancellationTiers,
      check_in_time: d.checkInTime,
      check_out_time: d.checkOutTime,
      igtf_enabled: d.igtfEnabled,
      igtf_rate: d.igtfRate / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)

  if (error) return { error: 'No se pudieron guardar los ajustes.' }

  // El nombre, el teléfono y la política salen en la web pública. La página de
  // cancelación es estática y se regenera aparte: los tramos se publican ahí.
  revalidatePath('/', 'layout')
  revalidatePath('/legal/cancelacion')
  revalidatePath('/admin/ajustes')

  return { ok: 'Ajustes guardados.' }
}

// ---------------------------------------------------------------------------
// Cuentas de cobro
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  method: z.enum(GUEST_METHODS as [PaymentMethod, ...PaymentMethod[]]),
  label: z.string().trim().min(2, 'Ponle un nombre reconocible').max(80),
  identifier: z.string().trim().min(3, 'Falta el dato al que se paga').max(120),
  holder: z.string().trim().max(120).or(z.literal('')),
  document: z
    .string()
    .trim()
    .max(40)
    .or(z.literal(''))
    .refine((v) => !documentError(v), (v) => ({ message: documentError(v) ?? 'Documento inválido' })),
  bank: z.string().trim().max(80).or(z.literal('')),
  instructions: z.string().trim().max(300).or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(99),
  isActive: z.coerce.boolean(),
})

export async function saveAccount(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireStaff()

  const parsed = accountSchema.safeParse({
    id: formData.get('id') ?? '',
    method: formData.get('method'),
    label: formData.get('label'),
    identifier: formData.get('identifier'),
    holder: formData.get('holder') ?? '',
    document: formData.get('document') ?? '',
    bank: formData.get('bank') ?? '',
    instructions: formData.get('instructions') ?? '',
    sortOrder: formData.get('sortOrder') || 0,
    isActive: formData.get('isActive') === 'on',
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const row = {
    method: d.method,
    label: d.label,
    identifier: d.identifier,
    holder: d.holder || null,
    document: d.document || null,
    bank: d.bank || null,
    instructions: d.instructions || null,
    sort_order: d.sortOrder,
    is_active: d.isActive,
  }

  const { error } = d.id
    ? await supabase.from('payment_accounts').update(row).eq('id', d.id)
    : await supabase.from('payment_accounts').insert(row)

  if (error) return { error: 'No se pudo guardar la cuenta.' }

  // Las cuentas se muestran al huésped en la página de su reserva.
  revalidatePath('/admin/ajustes')
  revalidatePath('/reserva', 'layout')

  return { ok: d.id ? 'Cuenta actualizada.' : 'Cuenta añadida.' }
}

export async function deleteAccount(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireStaff()

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Cuenta no válida.' }

  const supabase = await createClient()
  const { error } = await supabase.from('payment_accounts').delete().eq('id', id.data)

  if (error) return { error: 'No se pudo eliminar la cuenta.' }

  revalidatePath('/admin/ajustes')
  revalidatePath('/reserva', 'layout')

  return { ok: 'Cuenta eliminada.' }
}

// ---------------------------------------------------------------------------
// Diagnóstico de correo
// ---------------------------------------------------------------------------

/**
 * Reenvía a un huésped el enlace de su reserva.
 *
 * El código solo vive en la URL, así que cuando alguien escribe «no me llegó
 * nada» esta es la salida: sin esto habría que entrar a la base de datos a
 * buscar el código y mandarlo a mano.
 */
export async function resendBookingLink(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireStaff()

  const code = String(formData.get('code') ?? '').trim().toUpperCase()
  if (code.length < 4) return { error: 'Escribe el código de la reserva.' }

  const booking = await loadBookingEmail(code)
  if (!booking) return { error: `No existe la reserva ${code}.` }

  const sent = await sendBookingCreated(booking)

  revalidatePath('/admin/ajustes')

  return sent
    ? { ok: `Enlace reenviado a ${booking.guestEmail}.` }
    : { error: 'El envío falló. Revisa el registro de correo abajo.' }
}
