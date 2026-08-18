import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usd, ves, dateLabel } from '@/lib/format'
import { METHODS } from '@/lib/payment-methods'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { PaymentReportForm } from '@/components/payment-report-form'
import { CancellationSchedule, type RefundQuote } from '@/components/cancellation-schedule'
import { parseTiers } from '@/lib/cancellation'
import { CardCheckoutButton } from '@/components/card-checkout-button'
import { AwaitingWebhook } from '@/components/awaiting-webhook'
import { stripeEnabled, stripeIsTestMode } from '@/lib/stripe'
import type { PaymentMethod, PaymentStatus, BookingStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: `Reserva ${code.toUpperCase()}` }
}

type BookingView = {
  code: string
  status: BookingStatus
  check_in: string
  check_out: string
  nights: number
  guests: number
  guest_name: string
  guest_email: string
  unit_name: string
  unit_slug: string
  total_usd: number
  total_ves: number
  rate_snapshot: number
  rate_date: string | null
  rate_current: boolean
  deposit_ratio: number
  deposit_usd: number
  expires_at: string | null
  paid_usd: number
  payments: {
    method: PaymentMethod
    status: PaymentStatus
    currency: 'USD' | 'VES'
    amount: number
    reference: string | null
    created_at: string
    rejection_reason: string | null
  }[]
}

const STATUS: Record<BookingStatus, { label: string; tone: string; detail: string }> = {
  pending: {
    label: 'Pendiente de pago',
    tone: 'bg-amber-100 text-amber-900',
    detail: 'Las fechas están retenidas a tu nombre. Reporta el anticipo para confirmarla.',
  },
  confirmed: {
    label: 'Confirmada',
    tone: 'bg-moss/15 text-moss',
    detail: 'Tu reserva está confirmada. Te esperamos.',
  },
  checked_in: {
    label: 'Hospedado',
    tone: 'bg-tide/15 text-tide',
    detail: 'Estadía en curso. Que la disfrutes.',
  },
  completed: {
    label: 'Completada',
    tone: 'bg-ink/10 text-ink/70',
    detail: 'Gracias por tu visita.',
  },
  cancelled: {
    label: 'Cancelada',
    tone: 'bg-ink/10 text-ink/70',
    detail: 'Esta reserva fue cancelada.',
  },
  expired: {
    label: 'Expirada',
    tone: 'bg-ink/10 text-ink/70',
    detail: 'No se recibió el anticipo a tiempo y las fechas se liberaron.',
  },
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'text-ink/70' },
  verifying: { label: 'Por verificar', tone: 'text-amber-700' },
  approved: { label: 'Aprobado', tone: 'text-moss' },
  rejected: { label: 'Rechazado', tone: 'text-red-700' },
  refunded: { label: 'Reembolsado', tone: 'text-ink/70' },
}

// Volver del checkout no confirma nada: la confirmación llega por webhook, unos
// segundos después. El aviso depende del estado real de la reserva, no solo del
// parámetro de la URL: ese parámetro se queda al recargar, y sin mirar el estado
// el mensaje seguiría diciendo «lo estamos confirmando» sobre una reserva ya
// confirmada.

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await params
  const sp = await searchParams
  const checkout = Array.isArray(sp.pago) ? sp.pago[0] : sp.pago

  const supabase = await createClient()

  const [{ data }, { data: settings }, { data: accounts }] = await Promise.all([
    supabase.rpc('get_booking', { p_code: code }),
    supabase
      .from('app_settings')
      .select('business_name, business_email, business_phone, cancellation_policy, cancellation_tiers, check_in_time, check_out_time')
      .single(),
    supabase
      .from('payment_accounts')
      .select('id, method, label, holder, document, bank, identifier, instructions')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const booking = data as BookingView | { error: string } | null
  if (!booking || 'error' in booking) notFound()

  const businessName = settings?.business_name ?? 'reserVE'
  const status = STATUS[booking.status]
  const outstanding = Math.max(0, booking.deposit_usd - booking.paid_usd)
  const canReport = booking.status === 'pending' || booking.status === 'confirmed'
  const remaining = Math.max(0, booking.total_usd - booking.paid_usd)

  // Mientras falte el anticipo se cobra eso; después, el saldo. Mismo criterio
  // que usa el servidor al crear la sesión de Stripe.
  const cardAmount = outstanding > 0 ? outstanding : remaining

  // ¿Llegó ya el webhook? Se mira el estado real, no el parámetro de la URL.
  const cardSettled = booking.status !== 'pending' || booking.paid_usd > 0

  const tiers = parseTiers(settings?.cancellation_tiers)

  // El cálculo lo hace la base, no el navegador: las mismas cifras que verá el
  // operador al cancelar, sin dos implementaciones que puedan divergir.
  const { data: refundData } =
    booking.status === 'cancelled' || tiers.length === 0
      ? { data: null }
      : await supabase.rpc('cancellation_quote', { p_code: booking.code })

  const refund = refundData as RefundQuote | null

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-ink/70">{booking.code}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.tone}`}>
            {status.label}
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{booking.unit_name}</h1>
        <p className="mt-2 text-ink/70">
          {dateLabel(booking.check_in)} → {dateLabel(booking.check_out)} · {booking.nights}{' '}
          noche{booking.nights > 1 ? 's' : ''} · {booking.guests} huésped
          {booking.guests > 1 ? 'es' : ''}
        </p>
        <p className="mt-3 text-descripcion text-ink/70">{status.detail}</p>

        {/*
          Tres desenlaces distintos al volver del checkout, y solo el primero
          justifica pedir paciencia.
        */}
        {checkout === 'procesando' && !cardSettled && <AwaitingWebhook />}

        {checkout === 'procesando' && cardSettled && (
          <p className="mt-5 rounded-xl border border-moss/40 bg-moss/5 px-4 py-3 text-sm text-moss">
            Pago recibido y verificado. No hace falta que hagas nada más.
          </p>
        )}

        {checkout === 'cancelado' && (
          <p className="mt-5 rounded-xl border border-ink/20 bg-ink/5 px-4 py-3 text-sm text-ink/70">
            Cancelaste el pago con tarjeta. Tus fechas siguen retenidas.
          </p>
        )}

        {/* Resumen económico */}
        <section className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink/70">Total de la estadía</dt>
              <dd className="font-medium">{usd(booking.total_usd)}</dd>
            </div>
            <div className="flex justify-between text-ink/70">
              <dt>Equivalente a tasa BCV{booking.rate_date ? ` del ${dateLabel(booking.rate_date)}` : ''}</dt>
              <dd>{ves(booking.total_ves)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink/10 pt-3">
              <dt className="text-ink/70">
                Anticipo para confirmar ({Math.round(booking.deposit_ratio * 100)}%)
              </dt>
              <dd className="font-medium">{usd(booking.deposit_usd)}</dd>
            </div>
            {booking.paid_usd > 0 && (
              <div className="flex justify-between text-moss">
                <dt>Pagado y verificado</dt>
                <dd>−{usd(booking.paid_usd)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-ink/10 pt-3 font-medium">
              <dt>{outstanding > 0 ? 'Falta por el anticipo' : 'Saldo al llegar'}</dt>
              <dd>{usd(outstanding > 0 ? outstanding : remaining)}</dd>
            </div>
          </dl>

          {!booking.rate_current && booking.status === 'pending' && (
            <p className="mt-5 rounded-xl bg-clay/10 p-4 text-xs leading-relaxed text-ink/70">
              La tasa oficial cambió desde que reservaste. El total en dólares es el mismo;
              el monto en bolívares se recalcula al momento de pagar, porque la factura debe
              llevar la tasa del día de la transacción.
            </p>
          )}

          {booking.expires_at && booking.status === 'pending' && (
            <p className="mt-4 text-xs text-ink/70">
              Las fechas se liberan si no recibimos el anticipo antes del{' '}
              {new Intl.DateTimeFormat('es-VE', {
                dateStyle: 'long',
                timeStyle: 'short',
                timeZone: 'America/Caracas',
              }).format(new Date(booking.expires_at))}
              .
            </p>
          )}
        </section>

        {/* Tarjeta internacional */}
        {canReport && cardAmount > 0 && stripeEnabled() && (
          <section className="mt-8">
            <h2 className="text-xl font-semibold tracking-tight">Pago inmediato</h2>
            <p className="mt-2 text-descripcion text-ink/70">
              Confirmación automática, sin esperar verificación.
            </p>
            <div className="mt-5">
              <CardCheckoutButton
                code={booking.code}
                amountLabel={usd(cardAmount)}
                testMode={stripeIsTestMode()}
              />
            </div>
          </section>
        )}

        {/* Dónde pagar */}
        {canReport && accounts && accounts.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xl font-semibold tracking-tight">Cómo pagar</h2>
            <p className="mt-2 text-descripcion text-ink/70">
              Paga por el canal que prefieras y luego repórtalo abajo con el comprobante.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-2xl border border-ink/10 bg-white p-5">
                  <p className="text-xs uppercase tracking-wider text-ink/60">
                    {METHODS[a.method].label}
                  </p>
                  <p className="mt-1 font-medium">{a.label}</p>
                  <p className="mt-2 select-all font-mono text-sm">{a.identifier}</p>
                  <div className="mt-3 space-y-0.5 text-xs text-ink/70">
                    {a.holder && <p>{a.holder}</p>}
                    {a.document && <p>{a.document}</p>}
                    {a.bank && <p>{a.bank}</p>}
                    {a.instructions && <p className="mt-2 text-ink/60">{a.instructions}</p>}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-ink/60">
              Los cobros en bolívares se calculan a la tasa oficial del BCV, como exige la ley.
            </p>
          </section>
        )}

        {/* Reportar pago */}
        {canReport && (
          <section className="mt-10 rounded-2xl border border-ink/10 bg-white p-6">
            <h2 className="text-xl font-semibold tracking-tight">Reportar un pago</h2>
            <p className="mt-2 text-descripcion text-ink/70">
              Verificamos cada comprobante a mano antes de confirmar.
            </p>
            <div className="mt-6">
              <PaymentReportForm
                code={booking.code}
                suggestedUsd={outstanding > 0 ? outstanding : remaining}
                rate={booking.rate_snapshot}
              />
            </div>
          </section>
        )}

        {/*
          Con las fechas reales de esta reserva, no la regla en abstracto: la
          pregunta «¿hasta cuándo puedo cancelar?» se responde sin hacer cuentas.
        */}
        {tiers.length > 0 && booking.status !== 'cancelled' && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">Política de cancelación</h2>
            <p className="mt-2 text-descripcion text-ink/70">
              Entrada el {dateLabel(booking.check_in)} a las{' '}
              {(settings?.check_in_time ?? '13:00').slice(0, 5)}.
            </p>
            <div className="mt-5">
              <CancellationSchedule
                tiers={tiers}
                checkIn={booking.check_in}
                checkInTime={settings?.check_in_time ?? '13:00'}
                quote={refund ?? undefined}
                notes={settings?.cancellation_policy}
              />
            </div>
          </section>
        )}

        {/* Historial */}
        {booking.payments.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">Pagos reportados</h2>
            <ul className="mt-4 divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white">
              {booking.payments.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <p className="text-sm font-medium">
                      {METHODS[p.method].label} ·{' '}
                      {new Intl.NumberFormat('es-VE', {
                        style: 'currency',
                        currency: p.currency,
                      }).format(p.amount)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink/60">{p.reference}</p>
                    {p.rejection_reason && (
                      <p className="mt-1 text-xs text-red-700">{p.rejection_reason}</p>
                    )}
                  </div>
                  <span className={`text-sm ${PAYMENT_STATUS[p.status].tone}`}>
                    {PAYMENT_STATUS[p.status].label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 text-sm text-ink/70">
          ¿Dudas? Escríbenos a{' '}
          {settings?.business_email && (
            <a href={`mailto:${settings.business_email}`} className="underline">
              {settings.business_email}
            </a>
          )}
          {settings?.business_phone && <> o al {settings.business_phone}</>}.{' '}
          <Link href={`/alojamientos/${booking.unit_slug}`} className="underline">
            Ver el alojamiento
          </Link>
          .
        </p>
      </main>

      <SiteFooter
        businessName={businessName}
        email={settings?.business_email}
        phone={settings?.business_phone}
      />
    </>
  )
}
