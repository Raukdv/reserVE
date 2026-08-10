'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getProfile } from '@/lib/supabase/server'
import { loadBookingEmail, sendPaymentApproved, sendPaymentRejected } from '@/lib/email'

const decision = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export type ReviewState = { error?: string; ok?: string }

async function requireStaff() {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    throw new Error('No autorizado')
  }
  return profile
}

/**
 * Aprueba un pago reportado y, si el anticipo ya está cubierto, confirma la
 * reserva.
 *
 * El umbral se calcula sobre la suma de pagos aprobados, no sobre este pago
 * suelto: un huésped puede cubrir el anticipo en dos partes.
 */
export async function approvePayment(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = decision.safeParse({ paymentId: formData.get('paymentId') })
  if (!parsed.success) return { error: 'Pago inválido' }

  const staff = await requireStaff()
  const supabase = await createClient()

  const { data: payment, error: readError } = await supabase
    .from('payments')
    .select('id, booking_id, status, amount_usd')
    .eq('id', parsed.data.paymentId)
    .single()

  if (readError || !payment) return { error: 'Pago no encontrado' }
  if (payment.status === 'approved') return { ok: 'Ya estaba aprobado' }

  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'approved',
      reviewed_by: staff.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', payment.id)

  // El índice único sobre (method, reference) de pagos aprobados rechaza aquí
  // una referencia bancaria ya usada en otra reserva.
  if (updateError) {
    return updateError.code === '23505'
      ? { error: 'Esa referencia ya respalda otro pago aprobado' }
      : { error: 'No se pudo aprobar' }
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, code, status, total_usd, deposit_ratio')
    .eq('id', payment.booking_id)
    .single()

  let confirmed = false

  if (booking && booking.status === 'pending') {
    const { data: approved } = await supabase
      .from('payments')
      .select('amount_usd')
      .eq('booking_id', booking.id)
      .eq('status', 'approved')

    const paid = (approved ?? []).reduce((sum, p) => sum + Number(p.amount_usd), 0)
    const required = Number(booking.total_usd) * Number(booking.deposit_ratio)

    // El margen de un centavo absorbe el redondeo al convertir pagos en
    // bolívares: sin él, un anticipo exacto quedaría corto por 0,004 y la
    // reserva no se confirmaría nunca.
    if (paid + 0.01 >= required) {
      await supabase
        .from('bookings')
        .update({
          status: 'confirmed',
          expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id)

      confirmed = true
    }
  }

  if (booking) {
    const detail = await loadBookingEmail(booking.code)
    if (detail) {
      await sendPaymentApproved({
        ...detail,
        confirmed,
        pending: Math.max(
          0,
          confirmed ? detail.totalUsd - detail.paidUsd : detail.depositUsd - detail.paidUsd,
        ),
      })
    }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/calendario')
  revalidatePath('/admin/pagos')

  return {
    ok: confirmed ? 'Pago aprobado y reserva confirmada' : 'Pago aprobado. Anticipo aún incompleto.',
  }
}

/**
 * Rechaza un pago. No libera las fechas: el huésped puede corregir el
 * comprobante mientras la reserva siga viva. Si nunca lo hace, el job de
 * expiración se encarga.
 */
export async function rejectPayment(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = decision.safeParse({
    paymentId: formData.get('paymentId'),
    reason: formData.get('reason') || undefined,
  })
  if (!parsed.success) return { error: 'Datos inválidos' }

  const staff = await requireStaff()
  const supabase = await createClient()
  const reason = parsed.data.reason ?? 'No se pudo verificar el comprobante'

  const { data: updated, error } = await supabase
    .from('payments')
    .update({
      status: 'rejected',
      reviewed_by: staff.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', parsed.data.paymentId)
    .select('bookings ( code )')
    .single()

  if (error) return { error: 'No se pudo rechazar' }

  // Un rechazo sin aviso deja al huésped esperando una confirmación que no va a
  // llegar, hasta que las fechas expiran. El motivo va en el correo para que
  // pueda corregir en vez de adivinar.
  const booking = Array.isArray(updated?.bookings) ? updated.bookings[0] : updated?.bookings
  if (booking?.code) {
    const detail = await loadBookingEmail(booking.code)
    if (detail) await sendPaymentRejected({ ...detail, reason })
  }

  revalidatePath('/admin/pagos')
  return { ok: 'Pago rechazado' }
}
