'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { publicEnv } from '@/lib/env'
import { getStripe, toMinorUnits } from '@/lib/stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { METHODS, GUEST_METHODS } from '@/lib/payment-methods'
import { loadBookingEmail, sendPaymentReceived } from '@/lib/email'
import { documentError } from '@/lib/document'
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
  payerDocument: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(''))
    .refine((v) => !documentError(v), (v) => ({ message: documentError(v) ?? 'Documento inválido' })),
})

const ERRORS: Record<string, string> = {
  not_found: 'No encontramos esa reserva.',
  booking_closed: 'Esta reserva ya está cerrada.',
  invalid_currency: 'Moneda no válida para ese canal.',
  invalid_amount: 'Revisa el monto.',
  future_date: 'La fecha del pago no puede ser futura.',
}

export type ReportState = { error?: string; ok?: string }

/**
 * A dónde vuelve el huésped tras pasar por Stripe.
 *
 * En producción manda `NEXT_PUBLIC_SITE_URL`: la cabecera Host la controla quien
 * hace la petición, y confiar en ella permitiría desviar a alguien a otro sitio
 * justo después de pagar.
 *
 * En desarrollo se usa el host real de la petición. Si no, la vuelta apunta al
 * dominio de producción —que todavía no resuelve— y el huésped acaba en una
 * pantalla de error del navegador con el cobro ya hecho.
 */
async function returnOrigin(): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    return publicEnv.NEXT_PUBLIC_SITE_URL
  }

  const h = await headers()
  const host = h.get('host')
  if (!host) return publicEnv.NEXT_PUBLIC_SITE_URL

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

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

  // Acuse de recibo. Sin él, el huésped que no ve movimiento reporta el mismo
  // pago dos o tres veces y la bandeja se llena de duplicados.
  const booking = await loadBookingEmail(d.code)
  if (booking) {
    const amount = new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: spec.currency,
    }).format(d.amount)
    await sendPaymentReceived({ ...booking, amount })
  }

  revalidatePath(`/reserva/${d.code}`)
  revalidatePath('/admin/pagos')

  return { ok: 'Pago reportado. Lo verificamos y te avisamos por correo.' }
}

/**
 * Abre el checkout alojado de Stripe para pagar con tarjeta internacional.
 *
 * Se usa el checkout alojado y no un formulario propio: los datos de la tarjeta
 * nunca tocan este servidor ni este HTML, lo que deja el proyecto casi fuera del
 * alcance de PCI.
 *
 * El monto lo calcula el servidor a partir de la reserva. Nada de lo que llegue
 * del cliente sobre importes se usa.
 */
export async function startCardCheckout(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase()
  if (code.length < 4) return { error: 'Reserva no válida.' }

  const stripe = getStripe()
  if (!stripe) return { error: 'El pago con tarjeta no está disponible ahora mismo.' }

  const supabase = await createClient()
  const { data } = await supabase.rpc('get_booking', { p_code: code })
  const booking = data as {
    code?: string
    status?: string
    unit_name?: string
    total_usd?: number
    deposit_usd?: number
    paid_usd?: number
    check_in?: string
    check_out?: string
  } | null

  if (!booking?.code) return { error: 'No encontramos esa reserva.' }
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    return { error: 'Esta reserva ya está cerrada.' }
  }

  const paid = Number(booking.paid_usd ?? 0)
  const deposit = Number(booking.deposit_usd ?? 0)
  const total = Number(booking.total_usd ?? 0)

  // Mientras falte el anticipo se cobra eso; después, el saldo.
  const outstanding = paid < deposit ? deposit - paid : total - paid
  if (outstanding <= 0) return { error: 'No queda nada por pagar.' }

  const base = await returnOrigin()

  let session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: booking.code,
      metadata: { booking_code: booking.code },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: toMinorUnits(outstanding),
            product_data: {
              name: booking.unit_name ?? 'Reserva',
              description:
                `Reserva ${booking.code}` +
                (booking.check_in && booking.check_out
                  ? ` · ${booking.check_in} a ${booking.check_out}`
                  : ''),
            },
          },
        },
      ],
      // Volver aquí no confirma nada: la confirmación llega por webhook. Si el
      // huésped cierra la pestaña tras pagar, la reserva se confirma igual.
      success_url: `${base}/reserva/${booking.code}?pago=procesando`,
      cancel_url: `${base}/reserva/${booking.code}?pago=cancelado`,
    })
  } catch {
    return { error: 'No se pudo abrir el pago con tarjeta. Inténtalo de nuevo.' }
  }

  if (!session.url) return { error: 'No se pudo abrir el pago con tarjeta.' }

  redirect(session.url)
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
