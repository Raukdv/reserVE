'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { METHODS, GUEST_METHODS } from '@/lib/payment-methods'
import type { PaymentMethod } from '@/types/database'

const RECEIPTS_BUCKET = 'receipts'

/**
 * Tope del comprobante ya comprimido.
 *
 * El navegador redimensiona y convierte a WebP antes de subir, así que una
 * captura normal llega entre 80 y 150 KB. Este límite es la red de seguridad
 * del servidor: sin él, 1 GB de Storage del plan gratuito se agota en unos mil
 * comprobantes. Ver docs/COSTO-CERO.md, regla 3.6.
 */
const MAX_RECEIPT_BYTES = 300 * 1024

const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'application/pdf']

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

const schema = z.object({
  code: z.string().trim().min(4).max(16),
  method: z.enum(GUEST_METHODS as [PaymentMethod, ...PaymentMethod[]]),
  amount: z.coerce.number().positive('El monto debe ser mayor que cero'),
  origin: z.string().trim().max(200).optional().or(z.literal('')),
  reference: z.string().trim().min(3, 'Falta la referencia').max(120),
  paidAt: z.string().trim().min(1, 'Falta la fecha del pago'),
  payerName: z.string().trim().max(120).optional().or(z.literal('')),
  payerDocument: z.string().trim().max(40).optional().or(z.literal('')),
})

const ERRORS: Record<string, string> = {
  not_found: 'No encontramos esa reserva.',
  booking_closed: 'Esta reserva ya está cerrada.',
  invalid_currency: 'Moneda no válida para ese canal.',
  invalid_amount: 'Revisa el monto.',
  future_date: 'La fecha del pago no puede ser futura.',
}

export type ReportState = { error?: string; ok?: string }

export async function reportPayment(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const parsed = schema.safeParse({
    code: formData.get('code'),
    method: formData.get('method'),
    amount: formData.get('amount'),
    origin: formData.get('origin'),
    reference: formData.get('reference'),
    paidAt: formData.get('paidAt'),
    payerName: formData.get('payerName'),
    payerDocument: formData.get('payerDocument'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const d = parsed.data
  const spec = METHODS[d.method]

  // El comprobante es lo que hace verificable el reporte. Sin él, aprobar sería
  // creerle al huésped su palabra sobre una referencia que nadie puede contrastar.
  const receipt = formData.get('receipt')
  if (!(receipt instanceof File) || receipt.size === 0) {
    return { error: 'Adjunta la captura del pago.' }
  }

  if (!ALLOWED_TYPES.includes(receipt.type)) {
    return { error: 'La captura debe ser una imagen o un PDF.' }
  }

  if (receipt.size > MAX_RECEIPT_BYTES) {
    return {
      error: `La captura pesa ${Math.round(receipt.size / 1024)} KB y el máximo es ` +
        `${MAX_RECEIPT_BYTES / 1024} KB. Prueba con una imagen más pequeña.`,
    }
  }

  // El bucket es privado y no tiene ninguna política pública: se sube con la
  // clave de servicio desde aquí. Permitir inserción anónima directa dejaría a
  // cualquiera llenar el gigabyte del plan gratuito.
  const admin = createAdminClient()
  const path = `${d.code.toUpperCase()}/${randomUUID()}.${EXTENSIONS[receipt.type]}`

  const { error: uploadError } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, receipt, { contentType: receipt.type, upsert: false })

  if (uploadError) return { error: 'No se pudo subir la captura. Inténtalo de nuevo.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('report_payment', {
    p_code: d.code,
    p_method: d.method,
    p_currency: spec.currency,
    p_amount: d.amount,
    p_origin: d.origin || null,
    p_reference: d.reference,
    p_paid_at: new Date(d.paidAt).toISOString(),
    p_receipt_path: path,
    p_payer_name: d.payerName || null,
    p_payer_document: d.payerDocument || null,
  })

  if (error) {
    // Sin fila de pago, el archivo quedaría huérfano ocupando cuota.
    await admin.storage.from(RECEIPTS_BUCKET).remove([path])
    return { error: 'No se pudo registrar el pago. Inténtalo de nuevo.' }
  }

  const result = data as { ok: boolean; error?: string }

  if (!result.ok) {
    await admin.storage.from(RECEIPTS_BUCKET).remove([path])
    return { error: ERRORS[result.error ?? ''] ?? 'No se pudo registrar el pago.' }
  }

  revalidatePath(`/reserva/${d.code}`)
  revalidatePath('/admin/pagos')

  return { ok: 'Pago reportado. Lo verificamos y te avisamos por correo.' }
}

/**
 * Recalcula el monto en bolívares cuando cambió la tasa oficial.
 *
 * El total en dólares no se toca: ese es el precio pactado. Lo que se ajusta es
 * su equivalente, porque la factura debe llevar la tasa de la fecha de la
 * transacción.
 */
export async function refreshRate(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const code = String(formData.get('code') ?? '').trim()
  if (!code) return { error: 'Reserva no válida' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('refresh_booking_rate', { p_code: code })

  if (error) return { error: 'No se pudo actualizar el monto.' }

  const result = data as { ok: boolean; error?: string; changed?: boolean }
  if (!result.ok) {
    return {
      error: result.error === 'stale_rate'
        ? 'La tasa oficial no está actualizada. Escríbenos.'
        : 'No se pudo actualizar el monto.',
    }
  }

  revalidatePath(`/reserva/${code}`)
  return { ok: result.changed ? 'Monto actualizado a la tasa de hoy.' : 'Ya estaba al día.' }
}
