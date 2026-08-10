'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { loadBookingEmail, sendBookingCreated } from '@/lib/email'
import { documentError } from '@/lib/document'

const ISO = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  unitId: z.string().uuid(),
  checkIn: z.string().regex(ISO),
  checkOut: z.string().regex(ISO),
  guests: z.coerce.number().int().min(1).max(20),
  name: z.string().trim().min(3, 'Escribe tu nombre completo').max(120),
  email: z.string().trim().toLowerCase().email('Revisa el correo'),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  // El cliente ya valida, pero se puede saltar: un documento inválido acabaría
  // en una factura.
  document: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(''))
    .refine((v) => !documentError(v), (v) => ({ message: documentError(v) ?? 'Documento inválido' })),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
})

// Los mensajes salen de create_booking(), que a su vez delega en quote_stay().
// El servidor es la autoridad: el formulario no decide si una fecha está libre.
const ERRORS: Record<string, string> = {
  unavailable: 'Esas fechas se ocuparon mientras completabas los datos. Elige otras.',
  too_many_guests: 'Esta unidad no admite tantos huéspedes.',
  below_min_nights: 'La estadía es más corta que el mínimo de esta unidad.',
  above_max_nights: 'La estadía supera el máximo permitido.',
  too_soon: 'Esta unidad necesita más antelación.',
  invalid_dates: 'Revisa las fechas.',
  stale_rate: 'La tasa oficial no está actualizada. Escríbenos y cerramos la reserva a mano.',
  no_exchange_rate: 'No hay tasa de cambio cargada. Escríbenos para completar la reserva.',
  invalid_email: 'Revisa el correo.',
  missing_name: 'Escribe tu nombre.',
  unit_not_found: 'Ese alojamiento ya no está disponible.',
}

export type BookingState = { error?: string }

export async function createBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const parsed = schema.safeParse({
    unitId: formData.get('unitId'),
    checkIn: formData.get('checkIn'),
    checkOut: formData.get('checkOut'),
    guests: formData.get('guests'),
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    document: formData.get('document'),
    notes: formData.get('notes'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const d = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_booking', {
    p_unit_id: d.unitId,
    p_check_in: d.checkIn,
    p_check_out: d.checkOut,
    p_guests: d.guests,
    p_guest_name: d.name,
    p_guest_email: d.email,
    p_guest_phone: d.phone || null,
    p_guest_document: d.document || null,
    p_notes: d.notes || null,
  })

  if (error) return { error: 'No se pudo crear la reserva. Inténtalo de nuevo.' }

  const result = data as { ok: boolean; error?: string; code?: string }

  if (!result.ok || !result.code) {
    return { error: ERRORS[result.error ?? ''] ?? 'No se pudo crear la reserva.' }
  }

  // El código de la reserva solo vive en la URL: sin este correo, cerrar la
  // pestaña deja al huésped sin forma de volver a su reserva ni de pagarla. Aun
  // así no se aborta si falla — las fechas ya están retenidas y la reserva es
  // válida. El fallo queda en email_log.
  const booking = await loadBookingEmail(result.code)
  if (booking) await sendBookingCreated(booking)

  // El calendario público y el del panel cambian en cuanto se retienen las fechas.
  revalidatePath('/alojamientos', 'layout')
  revalidatePath('/admin/calendario')

  redirect(`/reserva/${result.code}`)
}
