import 'server-only'

import { Resend } from 'resend'
import { publicEnv, serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

/**
 * Correo transaccional.
 *
 * El código de la reserva solo vive en la URL, así que estos correos son el único
 * camino de vuelta del huésped a su reserva. Por eso cada envío queda registrado
 * en `email_log`: el plan Hobby retiene una hora de logs y un fallo silencioso
 * deja a alguien sin poder pagar y sin saber por qué.
 *
 * Ningún envío puede tumbar la operación que lo dispara. Una reserva creada sigue
 * siendo válida aunque el correo falle, así que todo se captura y se registra en
 * lugar de propagarse.
 */

type EmailKind = Database['public']['Enums']['email_kind']

type SendArgs = {
  kind: EmailKind
  to: string
  subject: string
  html: string
  bookingId?: string
}

async function send({ kind, to, subject, html, bookingId }: SendArgs): Promise<boolean> {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = serverEnv()
  const supabase = createAdminClient()

  const record = async (ok: boolean, providerId?: string, detail?: string) => {
    await supabase.from('email_log').insert({
      kind,
      recipient: to,
      booking_id: bookingId ?? null,
      ok,
      provider_id: providerId ?? null,
      detail: detail ?? null,
    })
  }

  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    await record(false, undefined, 'falta RESEND_API_KEY o RESEND_FROM_EMAIL')
    return false
  }

  try {
    const { data, error } = await new Resend(RESEND_API_KEY).emails.send({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    })

    if (error) {
      await record(false, undefined, error.message)
      return false
    }

    await record(true, data?.id)
    return true
  } catch (err) {
    await record(false, undefined, err instanceof Error ? err.message : 'error desconocido')
    return false
  }
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

// HTML plano y estilos en línea, sin librería de plantillas: los clientes de
// correo ignoran las hojas de estilo externas, y una dependencia más pesaría en
// el bundle sin aportar nada aquí.
const COLORS = { ink: '#16130f', sand: '#f6f1e9', moss: '#4a5d4e', muted: '#7a736a' }

function layout(businessName: string, body: string, footer?: string) {
  return `
<div style="background:${COLORS.sand};padding:32px 16px;font-family:-apple-system,Segoe UI,sans-serif;color:${COLORS.ink}">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:15px;font-weight:600">${businessName}</p>
    ${body}
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:${COLORS.muted};text-align:center">
    ${footer ?? `Este correo se envió automáticamente por tu reserva en ${businessName}.`}
  </p>
</div>`
}

const button = (href: string, label: string) => `
<a href="${href}" style="display:inline-block;background:${COLORS.ink};color:${COLORS.sand};
   text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px">${label}</a>`

const row = (label: string, value: string) => `
<tr>
  <td style="padding:6px 0;font-size:14px;color:${COLORS.muted}">${label}</td>
  <td style="padding:6px 0;font-size:14px;text-align:right">${value}</td>
</tr>`

const table = (rows: string) =>
  `<table style="width:100%;border-collapse:collapse;margin:20px 0">${rows}</table>`

const money = (value: number) =>
  new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value)

const day = (iso: string) =>
  new Intl.DateTimeFormat('es-VE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))

const bookingUrl = (code: string) => `${publicEnv.NEXT_PUBLIC_SITE_URL}/reserva/${code}`

export type BookingEmail = {
  id: string
  code: string
  guestName: string
  guestEmail: string
  unitName: string
  checkIn: string
  checkOut: string
  totalUsd: number
  depositUsd: number
  paidUsd: number
  businessName: string
}

/**
 * Reúne todo lo que necesitan las plantillas a partir del código de reserva.
 *
 * Va con la clave de servicio porque quien dispara el correo puede ser un huésped
 * sin sesión —al reportar un pago— y no debe poder leer la reserva por otra vía.
 * Devuelve null si algo falta, para que quien llame decida sin romperse.
 */
export async function loadBookingEmail(code: string): Promise<BookingEmail | null> {
  const supabase = createAdminClient()

  const [{ data: booking }, { data: settings }] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, code, guest_name, guest_email, check_in, check_out,
        total_usd, deposit_ratio,
        units ( name ),
        payments ( amount_usd, status )
      `)
      .eq('code', code.toUpperCase())
      .maybeSingle(),
    supabase.from('app_settings').select('business_name').single(),
  ])

  // Las reservas tomadas por teléfono pueden no tener correo. Sin destinatario
  // no hay nada que enviar, y quien llama debe poder distinguirlo de un fallo.
  if (!booking?.guest_email) return null

  const unit = Array.isArray(booking.units) ? booking.units[0] : booking.units
  const paidUsd = (booking.payments ?? [])
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + Number(p.amount_usd), 0)

  return {
    id: booking.id,
    code: booking.code,
    guestName: booking.guest_name,
    guestEmail: booking.guest_email,
    unitName: unit?.name ?? 'tu alojamiento',
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    totalUsd: Number(booking.total_usd),
    depositUsd: Number(booking.total_usd) * Number(booking.deposit_ratio),
    paidUsd,
    businessName: settings?.business_name ?? 'reserVE',
  }
}

/** Confirmación de que las fechas quedaron retenidas, con el enlace de vuelta. */
export function sendBookingCreated(b: BookingEmail) {
  const url = bookingUrl(b.code)

  return send({
    kind: 'booking_created',
    to: b.guestEmail,
    bookingId: b.id,
    subject: `Reserva ${b.code} · falta el anticipo para confirmarla`,
    html: layout(
      b.businessName,
      `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600">Tus fechas están retenidas</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Hola ${b.guestName}, guardamos ${b.unitName} a tu nombre. Para confirmarla hace falta
        el anticipo de <strong style="color:${COLORS.ink}">${money(b.depositUsd)}</strong>.
      </p>
      ${table(
        row('Código', `<strong>${b.code}</strong>`) +
        row('Alojamiento', b.unitName) +
        row('Entrada', day(b.checkIn)) +
        row('Salida', day(b.checkOut)) +
        row('Total', money(b.totalUsd)),
      )}
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
        En el siguiente enlace verás a dónde pagar y podrás reportar tu comprobante.
        <strong style="color:${COLORS.ink}">Guárdalo</strong>: es tu acceso a la reserva.
      </p>
      ${button(url, 'Ver mi reserva y pagar')}
      <p style="margin:20px 0 0;font-size:12px;color:${COLORS.muted};word-break:break-all">${url}</p>`,
    ),
  })
}

/** Acuse del comprobante. Evita que el huésped reporte dos veces por dudar. */
export function sendPaymentReceived(b: BookingEmail & { amount: string }) {
  return send({
    kind: 'payment_received',
    to: b.guestEmail,
    bookingId: b.id,
    subject: `Recibimos tu comprobante · reserva ${b.code}`,
    html: layout(
      b.businessName,
      `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600">Comprobante recibido</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Gracias ${b.guestName}. Registramos tu pago de <strong style="color:${COLORS.ink}">${b.amount}</strong>
        y lo estamos verificando contra nuestra cuenta. Te avisamos en cuanto quede confirmado,
        normalmente el mismo día.
      </p>
      ${button(bookingUrl(b.code), 'Ver el estado')}`,
    ),
  })
}

/** El pago cuadró. Si además cubrió el anticipo, la reserva quedó confirmada. */
export function sendPaymentApproved(b: BookingEmail & { confirmed: boolean; pending: number }) {
  return send({
    kind: 'payment_approved',
    to: b.guestEmail,
    bookingId: b.id,
    subject: b.confirmed
      ? `Reserva ${b.code} confirmada`
      : `Pago verificado · reserva ${b.code}`,
    html: layout(
      b.businessName,
      b.confirmed
        ? `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:${COLORS.moss}">Reserva confirmada</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Listo, ${b.guestName}. Verificamos tu pago y ${b.unitName} es tuya.
      </p>
      ${table(
        row('Código', `<strong>${b.code}</strong>`) +
        row('Entrada', day(b.checkIn)) +
        row('Salida', day(b.checkOut)) +
        row('Saldo al llegar', money(b.pending)),
      )}
      ${button(bookingUrl(b.code), 'Ver mi reserva')}`
        : `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600">Pago verificado</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Verificamos tu pago, ${b.guestName}. Todavía faltan
        <strong style="color:${COLORS.ink}">${money(b.pending)}</strong> para completar el
        anticipo y confirmar la reserva.
      </p>
      ${button(bookingUrl(b.code), 'Completar el pago')}`,
    ),
  })
}

/** El comprobante no cuadró. Se explica por qué y se deja volver a intentarlo. */
export function sendPaymentRejected(b: BookingEmail & { reason: string }) {
  return send({
    kind: 'payment_rejected',
    to: b.guestEmail,
    bookingId: b.id,
    subject: `No pudimos verificar tu pago · reserva ${b.code}`,
    html: layout(
      b.businessName,
      `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600">No pudimos verificar el pago</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Hola ${b.guestName}, revisamos el comprobante de la reserva ${b.code} y no logramos
        confirmarlo.
      </p>
      <p style="margin:0 0 20px;padding:14px;background:${COLORS.sand};border-radius:10px;font-size:14px;line-height:1.5">
        ${b.reason}
      </p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${COLORS.muted}">
        Tus fechas siguen retenidas. Puedes corregir los datos o subir otro comprobante desde
        el enlace de tu reserva.
      </p>
      ${button(bookingUrl(b.code), 'Reportar de nuevo')}`,
    ),
  })
}

/** Recordatorio la víspera, con el saldo que queda por cobrar al llegar. */
export function sendArrivalReminder(b: BookingEmail & { pending: number }) {
  return send({
    kind: 'arrival_reminder',
    to: b.guestEmail,
    bookingId: b.id,
    subject: `Te esperamos mañana · ${b.unitName}`,
    html: layout(
      b.businessName,
      `
      <p style="margin:0 0 8px;font-size:20px;font-weight:600">Nos vemos mañana</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.muted}">
        Hola ${b.guestName}, mañana ${day(b.checkIn)} te esperamos en ${b.unitName}.
      </p>
      ${table(
        row('Código', `<strong>${b.code}</strong>`) +
        row('Salida', day(b.checkOut)) +
        (b.pending > 0 ? row('Saldo al llegar', money(b.pending)) : ''),
      )}
      ${button(bookingUrl(b.code), 'Ver mi reserva')}`,
    ),
  })
}
