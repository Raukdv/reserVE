import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { usd, ves, dateLabel } from '@/lib/format'
import { METHODS } from '@/lib/payment-methods'
import { parseAppliedFees } from '@/lib/fees'
import { BookingActions, type RefundPreview } from '@/components/booking-actions'
import { CollectionSummary, collectionState } from '@/components/collection-summary'
import type { BookingStatus, PaymentMethod, PaymentStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: `Reserva ${code.toUpperCase()}` }
}

// Mismos tonos que el calendario y el resumen.
const PILL: Record<BookingStatus, { label: string; tone: string }> = {
  pending: { label: 'Pendiente de pago', tone: 'bg-amber-100 text-amber-900' },
  confirmed: { label: 'Confirmada', tone: 'bg-moss/15 text-moss' },
  checked_in: { label: 'Hospedado', tone: 'bg-tide/15 text-tide' },
  completed: { label: 'Completada', tone: 'bg-ink/8 text-ink/70' },
  cancelled: { label: 'Cancelada', tone: 'bg-ink/8 text-ink/70' },
  expired: { label: 'Expirada', tone: 'bg-ink/8 text-ink/70' },
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'text-ink/60' },
  verifying: { label: 'Por verificar', tone: 'text-amber-700' },
  approved: { label: 'Aprobado', tone: 'text-moss' },
  rejected: { label: 'Rechazado', tone: 'text-red-700' },
  refunded: { label: 'Reembolsado', tone: 'text-ink/60' },
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Caracas',
  }).format(new Date(iso))

/**
 * Ficha de reserva en modo lectura.
 *
 * El calendario enlaza aquí desde cada barra, así que la ruta debe existir aunque
 * la gestión completa —cambiar estado, cancelar, cobrar el saldo— siga pendiente.
 * Un enlace a una ruta inexistente no solo rompe al hacer clic: Next la precarga
 * y llena la consola de 404.
 */
export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await params
  const sp = await searchParams
  const justCreated = (Array.isArray(sp.creada) ? sp.creada[0] : sp.creada) === '1'

  const supabase = await createClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select(`
      code, status, check_in, check_out, nights, guests,
      guest_name, guest_email, guest_phone, guest_document, notes,
      subtotal_usd, fees_usd, fees_breakdown, discount_usd, total_usd, total_ves,
      rate_snapshot, rate_date, deposit_ratio, expires_at, created_at,
      manual_confirmation_reason, cancel_reason, refund_due_usd,
      units ( name, slug ),
      payments ( kind, method, status, currency, amount, amount_usd, reference, created_at )
    `)
    .eq('code', code.toUpperCase())
    .maybeSingle()

  if (!booking) notFound()

  const unit = Array.isArray(booking.units) ? booking.units[0] : booking.units
  const payments = booking.payments ?? []
  const collection = collectionState(booking, payments)
  const ordered = [...payments].sort((a, b) => a.created_at.localeCompare(b.created_at))

  // Qué prellenar al registrar un cobro: mientras falte el anticipo, eso;
  // después, lo que quede del total. Sugerir siempre el anticipo dejaba el campo
  // en cero en cuanto quedaba cubierto, que es justo cuando se cobra el saldo.
  const suggestedCharge =
    collection.paidUsd + 0.01 < collection.depositUsd
      ? collection.depositUsd - collection.paidUsd
      : Math.max(0, collection.totalUsd - collection.paidUsd)

  const pill = PILL[booking.status]
  const guestUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL}/reserva/${booking.code}`

  // Qué tocaría devolver si se cancelara ahora. Lo calcula la base, la misma
  // función que ve el huésped en su página: dos implementaciones divergirían.
  const open = booking.status === 'pending' || booking.status === 'confirmed' ||
               booking.status === 'checked_in'

  const { data: refundData } = open
    ? await supabase.rpc('cancellation_quote', { p_code: booking.code })
    : { data: null }

  const refund = refundData as RefundPreview | null

  // Lo ya devuelto. Las devoluciones se guardan con status 'refunded', que es lo
  // que las mantiene fuera de las sumas de «pagado» sin dejar de constar aquí.
  const refundedUsd = payments
    .filter((p) => p.kind === 'refund' && p.status === 'refunded')
    .reduce((sum, p) => sum + Number(p.amount_usd), 0)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin/calendario" className="text-sm text-ink/70 hover:underline">
        ← Calendario
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{booking.code}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.tone}`}>
          {pill.label}
        </span>
      </div>

      <p className="mt-3 text-ink/70">
        {unit?.name} · {dateLabel(booking.check_in)} → {dateLabel(booking.check_out)} ·{' '}
        {booking.nights} noche{booking.nights > 1 ? 's' : ''} · {booking.guests} huésped
        {booking.guests > 1 ? 'es' : ''}
      </p>

      {justCreated && (
        <p className="mt-6 rounded-2xl border border-moss/40 bg-moss/5 p-5 text-sm text-moss">
          <strong className="font-medium">Reserva creada.</strong> Las fechas quedaron
          retenidas. Registra el cobro abajo cuando recibas el dinero.
        </p>
      )}

      {/*
        El código solo vive en la URL y en el correo. Si la reserva se tomó por
        teléfono y no hay correo, este enlace es lo único que puede llegarle al
        huésped — hay que ponerlo donde el operador lo encuentre.
      */}
      <section className="mt-6 rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="text-base font-semibold">Enlace del huésped</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          {booking.guest_email
            ? 'Se le envió por correo. Compártelo también si lo pide.'
            : 'Esta reserva no tiene correo, así que hay que compartirlo a mano.'}
        </p>

        <input
          readOnly
          value={guestUrl}
          className="mt-3 w-full select-all rounded-lg border border-ink/15 bg-sand px-3 py-2 font-mono text-xs"
        />

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {booking.guest_phone && (
            <a
              href={`https://wa.me/${booking.guest_phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                `Hola ${booking.guest_name}, aquí está tu reserva en ${unit?.name ?? 'nuestra posada'}: ${guestUrl}`,
              )}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Enviar por WhatsApp
            </a>
          )}
          <a href={guestUrl} target="_blank" rel="noreferrer" className="text-ink/70 underline">
            Ver como lo ve el huésped
          </a>
        </div>
      </section>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Huésped</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Nombre" value={booking.guest_name} />
            <Row label="Correo" value={booking.guest_email} />
            <Row label="Teléfono" value={booking.guest_phone} />
            <Row label="Documento" value={booking.guest_document} />
          </dl>
          {booking.notes && (
            <p className="mt-4 rounded-xl bg-sand p-3 text-sm text-ink/70">{booking.notes}</p>
          )}
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Cobro</h2>

          <div className="mt-4">
            <CollectionSummary state={collection} />
          </div>

          <details className="mt-5 text-sm">
            <summary className="cursor-pointer text-xs text-ink/60">
              Desglose del precio
            </summary>
            <dl className="mt-3 space-y-2">
              <Row label="Alojamiento" value={usd(booking.subtotal_usd)} />
              {/*
                Cada cargo con su nombre. Antes había una única línea «Limpieza»
                que en realidad mostraba la suma de todos los cargos.
              */}
              {parseAppliedFees(booking.fees_breakdown).map((fee) => (
                <Row
                  key={fee.name}
                  label={fee.kind === 'percent' ? `${fee.name} (${fee.rate} %)` : fee.name}
                  value={usd(fee.amount_usd)}
                />
              ))}
              {booking.discount_usd > 0 && (
                <Row label="Descuento" value={`−${usd(booking.discount_usd)}`} />
              )}
              {booking.rate_date && (
                <Row
                  label={`Tasa BCV del ${dateLabel(booking.rate_date)}`}
                  value={`${booking.rate_snapshot.toLocaleString('es-VE')} Bs/USD`}
                />
              )}
            </dl>
          </details>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="text-base font-semibold">
          Pagos {payments.length > 0 && <span className="text-ink/60">· {payments.length}</span>}
        </h2>

        {payments.length > 0 ? (
          <ul className="mt-4 divide-y divide-ink/8">
            {/*
              En orden cronológico y numerados. No se etiquetan como «anticipo» o
              «saldo»: si alguien negocia pagar 80 sobre un anticipo de 37,20, esa
              etiqueta engaña. Lo que importa es cuánto entró y cuándo.
            */}
            {ordered.map((p, i) => {
              const status = PAYMENT_STATUS[p.status]
              // Una devolución es dinero que sale. Sin el signo, en una lista
              // mezclada con los cobros se lee como uno más y la reserva parece
              // haber recaudado el doble.
              const out = p.kind === 'refund'
              return (
                <li key={i} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink/60">{i + 1}.</span>{' '}
                    {out && <span className="text-ink/70">Devolución · </span>}
                    {METHODS[p.method as PaymentMethod].label} ·{' '}
                    <strong className={`font-medium ${out ? 'text-ink/70' : ''}`}>
                      {out && '−'}
                      {new Intl.NumberFormat('es-VE', {
                        style: 'currency',
                        currency: p.currency,
                      }).format(p.amount)}
                    </strong>
                    {p.currency !== 'USD' && (
                      <span className="text-ink/60">
                        {' '}≈ {out && '−'}{usd(p.amount_usd)}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-ink/60">
                      {when(p.created_at)}
                      {p.reference && <span className="ml-2 font-mono">{p.reference}</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm ${status.tone}`}>{status.label}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink/60">Sin pagos registrados.</p>
        )}

        {collection.claimedCount > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Hay {collection.claimedCount} comprobante
            {collection.claimedCount > 1 ? 's' : ''} sin verificar por{' '}
            {usd(collection.claimedUsd)}.{' '}
            <Link href="/admin/pagos" className="underline">
              Revisar en la bandeja
            </Link>
          </p>
        )}
      </section>

      <BookingActions
        code={booking.code}
        status={booking.status}
        outstandingUsd={suggestedCharge}
        rate={Number(booking.rate_snapshot)}
        refund={refund}
        refundDueUsd={booking.refund_due_usd === null ? null : Number(booking.refund_due_usd)}
        refundedUsd={refundedUsd}
        paidUsd={collection.paidUsd}
      />

      {booking.manual_confirmation_reason && (
        <p className="mt-5 rounded-2xl border border-clay/40 bg-clay/5 p-5 text-sm text-ink/70">
          <strong className="font-medium">Confirmada sin cobro.</strong>{' '}
          {booking.manual_confirmation_reason}
        </p>
      )}

      {booking.cancel_reason && (
        <p className="mt-5 rounded-2xl border border-ink/15 bg-ink/5 p-5 text-sm text-ink/70">
          <strong className="font-medium">Cancelada.</strong> {booking.cancel_reason}
        </p>
      )}

      <p className="mt-6 text-descripcion text-ink/70">
        Marcar entrada y salida todavía no está construido. Los comprobantes que reporta el
        huésped se verifican desde{' '}
        <Link href="/admin/pagos" className="underline">
          la bandeja de pagos
        </Link>
        .
      </p>
    </main>
  )
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string | null
  strong?: boolean
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink/70">{label}</dt>
      <dd className={strong ? 'font-medium' : ''}>{value || '—'}</dd>
    </div>
  )
}
