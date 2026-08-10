'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
import { loadBookingEmail, sendPaymentApproved } from '@/lib/email'
import { METHODS } from '@/lib/payment-methods'
import type { PaymentMethod } from '@/types/database'

export type BookingActionState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
  return profile
}

const ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso para esto.',
  not_found: 'No existe esa reserva.',
  booking_closed: 'La reserva ya está cerrada.',
  not_pending: 'La reserva ya no está pendiente.',
  invalid_currency: 'Moneda no válida.',
  invalid_amount: 'Revisa el monto.',
  missing_reason: 'Escribe el motivo.',
}

const ALL_METHODS = Object.keys(METHODS) as [PaymentMethod, ...PaymentMethod[]]

const paymentSchema = z.object({
  code: z.string().trim().min(4),
  method: z.enum(ALL_METHODS),
  amount: z.coerce.number().positive('El monto debe ser mayor que cero'),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(300).optional().or(z.literal('')),
})

/**
 * Registra un cobro que entró fuera de la app.
 *
 * Efectivo al llegar, una transferencia que ya viste en tu cuenta, o una reserva
 * cerrada por teléfono. Entra como aprobado —lo verificaste tú— y confirma la
 * reserva si cubre el anticipo.
 */
export async function recordPayment(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireStaff()

  const parsed = paymentSchema.safeParse({
    code: formData.get('code'),
    method: formData.get('method'),
    amount: formData.get('amount'),
    reference: formData.get('reference'),
    notes: formData.get('notes'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('staff_record_payment', {
    p_code: d.code,
    p_method: d.method,
    p_currency: METHODS[d.method].currency,
    p_amount: d.amount,
    p_reference: d.reference || null,
    p_notes: d.notes || null,
  })

  if (error) return { error: 'No se pudo registrar el cobro.' }

  const result = data as { ok: boolean; error?: string; confirmed?: boolean }
  if (!result.ok) return { error: ERRORS[result.error ?? ''] ?? 'No se pudo registrar.' }

  // El huésped se entera igual que si hubiera pagado por la web.
  const booking = await loadBookingEmail(d.code)
  if (booking) {
    await sendPaymentApproved({
      ...booking,
      confirmed: Boolean(result.confirmed),
      pending: Math.max(
        0,
        result.confirmed
          ? booking.totalUsd - booking.paidUsd
          : booking.depositUsd - booking.paidUsd,
      ),
    })
  }

  revalidatePath(`/admin/reservas/${d.code}`)
  revalidatePath('/admin')
  revalidatePath('/admin/calendario')

  return {
    ok: result.confirmed ? 'Cobro registrado y reserva confirmada.' : 'Cobro registrado.',
  }
}

/**
 * Confirma sin cobro.
 *
 * Cortesía, acuerdo especial, o dinero que llegará después. Rompe la regla de
 * «confirmada implica anticipo cubierto», así que el motivo es obligatorio y
 * queda guardado con quién lo hizo.
 */
export async function confirmWithoutPayment(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireStaff()

  const code = String(formData.get('code') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()

  if (code.length < 4) return { error: 'Reserva no válida.' }
  if (reason.length < 3) return { error: 'Escribe el motivo de la confirmación.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_confirm_booking', {
    p_code: code,
    p_reason: reason,
  })

  if (error) return { error: 'No se pudo confirmar.' }

  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { error: ERRORS[result.error ?? ''] ?? 'No se pudo confirmar.' }

  revalidatePath(`/admin/reservas/${code}`)
  revalidatePath('/admin')
  revalidatePath('/admin/calendario')

  return { ok: 'Reserva confirmada sin cobro.' }
}

/** Marca la llegada del huésped. Solo desde una reserva confirmada. */
export async function checkIn(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireStaff()

  const code = String(formData.get('code') ?? '').trim()
  if (code.length < 4) return { error: 'Reserva no válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_check_in', { p_code: code })

  if (error) return { error: 'No se pudo marcar la entrada.' }

  const result = data as { ok: boolean; error?: string; early?: boolean }
  if (!result.ok) {
    return {
      error:
        result.error === 'not_confirmed'
          ? 'Solo se puede marcar la entrada de una reserva confirmada.'
          : (ERRORS[result.error ?? ''] ?? 'No se pudo marcar la entrada.'),
    }
  }

  revalidatePath(`/admin/reservas/${code}`)
  revalidatePath('/admin')
  revalidatePath('/admin/calendario')

  return {
    ok: result.early
      ? 'Entrada marcada, antes de la fecha prevista.'
      : 'Entrada marcada.',
  }
}

/**
 * Marca la salida y cierra la estadía.
 *
 * Se niega si queda saldo, salvo que se fuerce. Cerrar con dinero pendiente es
 * cómo se pierde un cobro: el huésped se va, la reserva queda «completada» y
 * nadie vuelve a mirarla.
 */
export async function checkOut(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireStaff()

  const code = String(formData.get('code') ?? '').trim()
  const force = formData.get('force') === 'on'
  if (code.length < 4) return { error: 'Reserva no válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_check_out', {
    p_code: code,
    p_force: force,
  })

  if (error) return { error: 'No se pudo marcar la salida.' }

  const result = data as { ok: boolean; error?: string; due_usd?: number }

  if (!result.ok) {
    if (result.error === 'balance_due') {
      const due = new Intl.NumberFormat('es-VE', {
        style: 'currency',
        currency: 'USD',
      }).format(Number(result.due_usd ?? 0))

      return {
        error:
          `Quedan ${due} sin cobrar. Regístralos arriba, o marca «cerrar con saldo ` +
          'pendiente» si acordaste cobrarlos después.',
      }
    }
    return {
      error:
        result.error === 'not_checked_in'
          ? 'Primero hay que marcar la entrada.'
          : (ERRORS[result.error ?? ''] ?? 'No se pudo marcar la salida.'),
    }
  }

  revalidatePath(`/admin/reservas/${code}`)
  revalidatePath('/admin')
  revalidatePath('/admin/calendario')

  return {
    ok:
      Number(result.due_usd ?? 0) > 0
        ? 'Salida marcada con saldo pendiente.'
        : 'Salida marcada. Estadía completada.',
  }
}

/** Cancela y libera las fechas. La reserva se conserva con su motivo. */
export async function cancelBooking(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireStaff()

  const code = String(formData.get('code') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()

  if (code.length < 4) return { error: 'Reserva no válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_cancel_booking', {
    p_code: code,
    p_reason: reason || null,
  })

  if (error) return { error: 'No se pudo cancelar.' }

  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { error: ERRORS[result.error ?? ''] ?? 'No se pudo cancelar.' }

  revalidatePath(`/admin/reservas/${code}`)
  revalidatePath('/admin')
  revalidatePath('/admin/calendario')
  revalidatePath('/alojamientos', 'layout')

  return { ok: 'Reserva cancelada y fechas liberadas.' }
}
