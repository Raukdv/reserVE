import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usd, ves, dateLabel } from '@/lib/format'
import { METHODS } from '@/lib/payment-methods'
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
  completed: { label: 'Completada', tone: 'bg-ink/8 text-ink/60' },
  cancelled: { label: 'Cancelada', tone: 'bg-ink/8 text-ink/60' },
  expired: { label: 'Expirada', tone: 'bg-ink/8 text-ink/60' },
}

const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  verifying: 'Por verificar',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
}

/**
 * Ficha de reserva en modo lectura.
 *
 * El calendario enlaza aquí desde cada barra, así que la ruta debe existir aunque
 * la gestión completa —cambiar estado, cancelar, cobrar el saldo— siga pendiente.
 * Un enlace a una ruta inexistente no solo rompe al hacer clic: Next la precarga
 * y llena la consola de 404.
 */
export default async function BookingDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select(`
      code, status, check_in, check_out, nights, guests,
      guest_name, guest_email, guest_phone, guest_document, notes,
      subtotal_usd, cleaning_fee_usd, total_usd, total_ves,
      rate_snapshot, rate_date, deposit_ratio, expires_at, created_at,
      units ( name, slug ),
      payments ( method, status, currency, amount, amount_usd, reference, created_at )
    `)
    .eq('code', code.toUpperCase())
    .maybeSingle()

  if (!booking) notFound()

  const unit = Array.isArray(booking.units) ? booking.units[0] : booking.units
  const payments = booking.payments ?? []
  const paid = payments
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + Number(p.amount_usd), 0)

  const deposit = Number(booking.total_usd) * Number(booking.deposit_ratio)
  const pill = PILL[booking.status]

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/admin/calendario" className="text-sm text-ink/50 hover:underline">
        ← Calendario
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{booking.code}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.tone}`}>
          {pill.label}
        </span>
      </div>

      <p className="mt-3 text-ink/60">
        {unit?.name} · {dateLabel(booking.check_in)} → {dateLabel(booking.check_out)} ·{' '}
        {booking.nights} noche{booking.nights > 1 ? 's' : ''} · {booking.guests} huésped
        {booking.guests > 1 ? 'es' : ''}
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-sm font-medium">Huésped</h2>
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
          <h2 className="text-sm font-medium">Importes</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Alojamiento" value={usd(booking.subtotal_usd)} />
            <Row label="Limpieza" value={usd(booking.cleaning_fee_usd)} />
            <Row label="Total" value={usd(booking.total_usd)} strong />
            <Row label="En bolívares" value={ves(booking.total_ves)} />
            <Row
              label={`Anticipo (${Math.round(booking.deposit_ratio * 100)}%)`}
              value={usd(deposit)}
            />
            <Row label="Verificado" value={usd(paid)} />
            <Row label="Pendiente" value={usd(Math.max(0, booking.total_usd - paid))} strong />
          </dl>
          {booking.rate_date && (
            <p className="mt-4 text-xs text-ink/45">
              Tasa BCV del {dateLabel(booking.rate_date)}:{' '}
              {booking.rate_snapshot.toLocaleString('es-VE')} Bs/USD
            </p>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="text-sm font-medium">Pagos</h2>
        {payments.length > 0 ? (
          <ul className="mt-4 divide-y divide-ink/8">
            {payments.map((p, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
                <span>
                  {METHODS[p.method as PaymentMethod].label} ·{' '}
                  {new Intl.NumberFormat('es-VE', {
                    style: 'currency',
                    currency: p.currency,
                  }).format(p.amount)}
                  <span className="ml-2 font-mono text-xs text-ink/45">{p.reference}</span>
                </span>
                <span className="text-ink/55">{PAYMENT_STATUS[p.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink/45">Sin pagos reportados.</p>
        )}
      </section>

      <p className="mt-6 rounded-2xl border border-dashed border-ink/20 p-5 text-sm text-ink/55">
        Cambiar estado, marcar entrada y salida, cancelar y cobrar el saldo todavía no
        están construidos. Los pagos se verifican desde{' '}
        <Link href="/admin/pagos" className="underline">
          la bandeja
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
      <dt className="text-ink/55">{label}</dt>
      <dd className={strong ? 'font-medium' : ''}>{value || '—'}</dd>
    </div>
  )
}
