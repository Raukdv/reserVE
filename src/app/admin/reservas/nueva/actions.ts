'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
import { loadBookingEmail, sendBookingCreated } from '@/lib/email'
import { documentError } from '@/lib/document'

const ISO = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    unitId: z.string().uuid('Elige una unidad'),
    checkIn: z.string().regex(ISO, 'Revisa la fecha de entrada'),
    checkOut: z.string().regex(ISO, 'Revisa la fecha de salida'),
    guests: z.coerce.number().int().min(1).max(20),
    name: z.string().trim().min(3, 'Escribe el nombre del huésped').max(120),
    email: z.string().trim().toLowerCase().email('Revisa el correo').or(z.literal('')),
    phone: z.string().trim().max(40).or(z.literal('')),
    document: z
      .string()
      .trim()
      .max(40)
      .or(z.literal(''))
      .refine((v) => !documentError(v), (v) => ({ message: documentError(v) ?? 'Documento inválido' })),
    notes: z.string().trim().max(1000).or(z.literal('')),
    discount: z.coerce.number().min(0, 'El descuento no puede ser negativo'),
    notify: z.coerce.boolean(),
  })
  .refine((d) => d.email !== '' || d.phone !== '', {
    message: 'Hace falta al menos un correo o un teléfono para contactar al huésped',
    path: ['email'],
  })

const ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso para esto.',
  missing_name: 'Escribe el nombre del huésped.',
  missing_contact: 'Hace falta un correo o un teléfono.',
  invalid_email: 'Revisa el correo.',
  unavailable: 'Esas fechas ya están ocupadas en esa unidad.',
  too_many_guests: 'Supera la capacidad de la unidad.',
  above_max_nights: 'La estadía supera el máximo permitido.',
  invalid_dates: 'La salida debe ser posterior a la entrada.',
  unit_not_found: 'Esa unidad ya no existe.',
  stale_rate: 'La tasa oficial no está actualizada. Revisa el cron antes de cotizar.',
  no_exchange_rate: 'No hay tasa de cambio cargada.',
  discount_too_large: 'El descuento supera el total.',
}

export type NewBookingState = { error?: string }

/**
 * Crea una reserva desde el panel.
 *
 * Para las que entran por teléfono o WhatsApp, donde el huésped no usa la web.
 * A diferencia del formulario público:
 *
 * - el correo es opcional, porque muchas veces solo se tiene el teléfono;
 * - se admite descuento, porque el precio se negocia;
 * - se puede cerrar para hoy mismo, saltándose la antelación mínima, que existe
 *   para la web donde nadie confirma del otro lado.
 *
 * Lo que NO se salta es la disponibilidad: eso lo decide la restricción de la
 * base, igual que en una reserva del huésped.
 */
export async function createBookingAsStaff(
  _prev: NewBookingState,
  formData: FormData,
): Promise<NewBookingState> {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return { error: 'No autorizado.' }
  }

  const parsed = schema.safeParse({
    unitId: formData.get('unitId'),
    checkIn: formData.get('checkIn'),
    checkOut: formData.get('checkOut'),
    guests: formData.get('guests'),
    name: formData.get('name'),
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    document: formData.get('document') ?? '',
    notes: formData.get('notes') ?? '',
    discount: formData.get('discount') || 0,
    notify: formData.get('notify') === 'on',
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('staff_create_booking', {
    p_unit_id: d.unitId,
    p_check_in: d.checkIn,
    p_check_out: d.checkOut,
    p_guests: d.guests,
    p_guest_name: d.name,
    p_guest_email: d.email || null,
    p_guest_phone: d.phone || null,
    p_guest_document: d.document || null,
    p_notes: d.notes || null,
    p_discount_usd: d.discount,
  })

  if (error) return { error: 'No se pudo crear la reserva.' }

  const result = data as { ok: boolean; error?: string; code?: string; has_email?: boolean }

  if (!result.ok || !result.code) {
    return { error: ERRORS[result.error ?? ''] ?? 'No se pudo crear la reserva.' }
  }

  // El aviso es opcional a propósito: si el operador ya quedó por WhatsApp, un
  // correo automático sobra. Y sin correo no hay a dónde mandarlo.
  if (d.notify && result.has_email) {
    const booking = await loadBookingEmail(result.code)
    if (booking) await sendBookingCreated(booking)
  }

  revalidatePath('/admin/reservas')
  revalidatePath('/admin/calendario')
  revalidatePath('/alojamientos', 'layout')

  redirect(`/admin/reservas/${result.code}?creada=1`)
}
