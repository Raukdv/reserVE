import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, fromMinorUnits } from '@/lib/stripe'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/server'
import { loadBookingEmail, sendPaymentApproved } from '@/lib/email'

// Necesita el runtime de Node y el cuerpo sin procesar: la firma se calcula sobre
// los bytes exactos que envió Stripe, así que no puede pasar por un parser JSON.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Webhook de Stripe.
 *
 * Es la única fuente de verdad sobre si un cobro ocurrió. Volver al sitio tras
 * pagar no confirma nada: si el huésped cierra la pestaña o pierde la conexión,
 * el dinero se movió igual y la reserva tiene que confirmarse. Stripe reintenta
 * hasta recibir un 2xx, así que este camino aguanta cortes que el navegador no.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const { STRIPE_WEBHOOK_SECRET } = serverEnv()

  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'stripe no configurado' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'sin firma' }, { status: 400 })
  }

  // Verificar la firma es lo que impide que cualquiera que descubra esta URL se
  // confirme reservas gratis inventando un evento.
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      STRIPE_WEBHOOK_SECRET,
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'firma inválida' },
      { status: 400 },
    )
  }

  if (event.type !== 'checkout.session.completed') {
    // Reconocido y descartado: devolver un error haría que Stripe reintentara
    // eventos que nunca vamos a procesar.
    return NextResponse.json({ ignored: event.type })
  }

  const session = event.data.object as Stripe.Checkout.Session

  if (session.payment_status !== 'paid') {
    return NextResponse.json({ ignored: 'sesión sin pagar' })
  }

  const code = session.client_reference_id ?? session.metadata?.booking_code
  if (!code) {
    return NextResponse.json({ error: 'sesión sin código de reserva' }, { status: 400 })
  }

  const amount = fromMinorUnits(session.amount_total ?? 0)

  const { data, error } = await createAdminClient().rpc('record_gateway_payment', {
    p_code: code,
    p_provider: 'stripe',
    p_provider_ref: session.id,
    p_method: 'tarjeta',
    p_currency: (session.currency ?? 'usd').toUpperCase(),
    p_amount: amount,
    p_amount_usd: amount,
    p_payload: {
      event_id: event.id,
      // `payment_intent` llega como identificador salvo que se pida expandido;
      // se normaliza para guardar siempre una cadena.
      payment_intent:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      customer_email: session.customer_details?.email ?? null,
      livemode: event.livemode,
    },
  })

  // Un 500 hace que Stripe reintente, que es lo correcto ante un fallo temporal
  // de base de datos: el cobro ya ocurrió y la reserva tiene que registrarlo.
  if (error) {
    return NextResponse.json({ error: 'no se pudo registrar' }, { status: 500 })
  }

  const result = data as { ok: boolean; duplicate?: boolean; confirmed?: boolean; error?: string }

  if (!result.ok) {
    // La reserva no existe: reintentar no va a cambiarlo. Se acepta el evento
    // para que Stripe deje de insistir, y queda el registro del cobro huérfano
    // en su panel para revisarlo a mano.
    return NextResponse.json({ error: result.error, unresolved: true })
  }

  // Los reintentos de Stripe son normales; solo se avisa la primera vez.
  if (!result.duplicate) {
    const booking = await loadBookingEmail(code)
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
  }

  return NextResponse.json(result)
}
