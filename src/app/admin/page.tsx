import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRateSummary } from '@/lib/rates'
import { usd, dateLabel } from '@/lib/format'
import { businessToday, daysBetween } from '@/lib/business-date'
import { RefreshRate } from '@/components/refresh-rate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Resumen' }

export default async function AdminHome() {
  const supabase = await createClient()
  const today = businessToday()

  const [
    { count: pendingPayments },
    { count: pendingBookings },
    { count: confirmedBookings },
    { data: arrivals },
    { data: departures },
    rates,
    { data: upcoming },
    { data: stalled },
  ] = await Promise.all([
    supabase.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'verifying'),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'confirmed'),
    supabase
      .from('bookings')
      .select('code, guest_name, guests, units(name)')
      .eq('check_in', today)
      .in('status', ['confirmed', 'pending']),
    supabase
      .from('bookings')
      .select('code, guest_name, units(name)')
      .eq('check_out', today)
      .in('status', ['confirmed', 'checked_in']),
    getRateSummary(),
    supabase
      .from('bookings')
      .select('code, guest_name, check_in, check_out, total_usd, status, units(name)')
      .gte('check_in', today)
      .in('status', ['confirmed', 'pending'])
      .order('check_in')
      .limit(8),

    /*
      Estadías que se quedaron a medias.

      Se deriva en la consulta, no se marca en la base: así el aviso desaparece
      solo en cuanto el operador registra lo que faltaba, sin dejar un estado
      escrito que luego haya que corregir. Es como lo resuelven los PMS —el
      cierre de día señala discrepancias y las resuelve una persona— y evita lo
      contrario: que un proceso automático cierre una reserva y con ella una
      cobranza que nadie volverá a mirar.

      El corte es `check_out` y no `check_in` a propósito: hasta la fecha de
      salida el huésped todavía puede aparecer, y avisar el mismo día de llegada
      sería ruido diario.
    */
    supabase
      .from('bookings')
      .select('code, guest_name, check_in, check_out, status, total_usd, units(name)')
      .in('status', ['confirmed', 'checked_in'])
      .lt('check_out', today)
      .order('check_out')
      .limit(20),
  ])

  const unitName = (u: unknown) => {
    const unit = Array.isArray(u) ? u[0] : u
    return (unit as { name?: string } | null)?.name ?? '—'
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>

      {rates.stale && (
        <p className="mt-4 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-medium">Tasa desactualizada.</strong> La última tasa
          oficial es del {rates.rateDate ?? 'nunca'}. No se puede cotizar en bolívares
          hasta que el alimentador vuelva a correr — revisa el cron.
        </p>
      )}

      {stalled && stalled.length > 0 && (
        <section className="mt-6 rounded-2xl border border-clay/60 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Requieren revisión</h2>
            <span className="text-xs text-ink/60">
              {stalled.length} estadía{stalled.length === 1 ? '' : 's'} sin cerrar
            </span>
          </div>
          <p className="mt-1 text-descripcion text-ink/70">
            Pasó la fecha de salida y la reserva sigue abierta. El sistema no las cierra
            solo: puede que el huésped no apareciera, que llegara y nadie lo registrara, o
            que se fuera sin avisar. Cada una se decide mirándola.
          </p>

          <ul className="mt-4 divide-y divide-ink/8">
            {stalled.map((b) => {
              const days = daysBetween(b.check_out, today)
              return (
                <li key={b.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <Link
                    href={`/admin/reservas/${b.code}`}
                    className="font-mono text-xs underline"
                  >
                    {b.code}
                  </Link>
                  <span className="text-sm">{b.guest_name}</span>
                  <span className="text-sm text-ink/70">{unitName(b.units)}</span>

                  <span className="ml-auto text-sm text-ink/70">
                    {/*
                      Se nombra lo que falta, no un diagnóstico: la app sabe qué
                      no se registró, no por qué. Llamarlo «no-show» sería
                      decidir por el operador, y de eso depende si se devuelve
                      dinero o se retiene.
                    */}
                    {b.status === 'confirmed'
                      ? 'Nunca se marcó la entrada'
                      : 'Entró y no se marcó la salida'}
                    {' · '}
                    <span className="text-ink">
                      {days === 1 ? 'salió ayer' : `hace ${days} días`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>

          <p className="mt-4 text-xs text-ink/60">
            Se resuelven en la ficha: marcar la entrada si llegó, la salida si se fue, o
            cancelar. El aviso desaparece solo al registrarlo.
          </p>
        </section>
      )}

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Pagos por verificar"
          value={pendingPayments ?? 0}
          href="/admin/pagos"
          highlight={Boolean(pendingPayments)}
        />
        <Stat label="Reservas pendientes" value={pendingBookings ?? 0} href="/admin/reservas" />
        <Stat label="Confirmadas" value={confirmedBookings ?? 0} href="/admin/reservas" />
        <Stat
          label="Tasa BCV"
          value={rates.rate ? rates.rate.toLocaleString('es-VE') : '—'}
          hint={rates.rateDate ?? undefined}
          highlight={rates.stale}
        />
        {/*
          La brecha es solo informativa. Cobrar a una tasa distinta de la oficial
          es infracción a la Ley de Precios Justos; la única palanca legal frente
          a la brecha es el precio de lista en USD.
        */}
        <Stat
          label="Brecha paralelo"
          value={rates.gap === null ? '—' : `${(rates.gap * 100).toFixed(1)}%`}
          hint={
            rates.parallel
              ? `informal ${rates.parallel.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`
              : undefined
          }
        />
      </dl>

      <RefreshRate />

      {rates.gap !== null && rates.gap > 0.05 && (
        <p className="mt-4 text-xs text-ink/70">
          Los cobros en bolívares van a tasa BCV por obligación legal, así que la brecha
          del {(rates.gap * 100).toFixed(1)}% la absorben tus tarifas en USD. Si te
          aprieta, el ajuste correcto es el precio de lista — no la tasa.
        </p>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Panel title="Llegadas de hoy">
          {arrivals && arrivals.length > 0 ? (
            <ul className="divide-y divide-ink/8">
              {arrivals.map((b) => (
                <li key={b.code} className="flex justify-between gap-4 py-3 text-sm">
                  <span>{b.guest_name}</span>
                  <span className="text-ink/70">{unitName(b.units)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Sin llegadas hoy.</Empty>
          )}
        </Panel>

        <Panel title="Salidas de hoy">
          {departures && departures.length > 0 ? (
            <ul className="divide-y divide-ink/8">
              {departures.map((b) => (
                <li key={b.code} className="flex justify-between gap-4 py-3 text-sm">
                  <span>{b.guest_name}</span>
                  <span className="text-ink/70">{unitName(b.units)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Sin salidas hoy.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Próximas reservas" className="mt-5">
        {upcoming && upcoming.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/60">
                <th className="pb-2 font-normal">Código</th>
                <th className="pb-2 font-normal">Huésped</th>
                <th className="pb-2 font-normal">Unidad</th>
                <th className="pb-2 font-normal">Estadía</th>
                <th className="pb-2 text-right font-normal">Total</th>
                <th className="pb-2 text-right font-normal">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8">
              {upcoming.map((b) => (
                <tr key={b.code} className="group cursor-pointer hover:bg-sand/60">
                  {/*
                    El enlace va dentro de la primera celda y se estira sobre toda
                    la fila: anidar <a> alrededor de <tr> no es HTML válido y los
                    navegadores lo reescriben fuera de la tabla.
                  */}
                  <td className="relative py-3 font-mono text-xs">
                    <Link
                      href={`/admin/reservas/${b.code}`}
                      className="absolute inset-0"
                      aria-label={`Ver reserva ${b.code}`}
                    />
                    {b.code}
                  </td>
                  <td className="py-3">{b.guest_name}</td>
                  <td className="py-3 text-ink/70">{unitName(b.units)}</td>
                  <td className="py-3 text-ink/70">
                    {dateLabel(b.check_in)} → {dateLabel(b.check_out)}
                  </td>
                  <td className="py-3 text-right">{usd(b.total_usd)}</td>
                  <td className="py-3 text-right">
                    <StatusPill status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No hay reservas próximas.</Empty>
        )}
      </Panel>
    </main>
  )
}

function Stat({
  label,
  value,
  href,
  hint,
  highlight = false,
}: {
  label: string
  value: number | string
  href?: string
  hint?: string
  highlight?: boolean
}) {
  const body = (
    <div
      className={`rounded-2xl border bg-white p-5 transition ${
        highlight ? 'border-clay/60' : 'border-ink/10'
      } ${href ? 'hover:border-ink/30' : ''}`}
    >
      <p className="text-sm text-ink/70">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

function Panel({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-ink/10 bg-white p-6 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink/60">{children}</p>
}

// Mismos tonos que el calendario, en versión suave para texto sobre fondo claro.
const PILL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'bg-amber-100 text-amber-900' },
  confirmed: { label: 'Confirmada', tone: 'bg-moss/15 text-moss' },
  checked_in: { label: 'Hospedado', tone: 'bg-tide/15 text-tide' },
  completed: { label: 'Completada', tone: 'bg-ink/8 text-ink/70' },
  cancelled: { label: 'Cancelada', tone: 'bg-ink/8 text-ink/70' },
  expired: { label: 'Expirada', tone: 'bg-ink/8 text-ink/70' },
}

function StatusPill({ status }: { status: string }) {
  const pill = PILL[status] ?? { label: status, tone: 'bg-ink/8 text-ink/70' }
  return <span className={`rounded-full px-2.5 py-1 text-xs ${pill.tone}`}>{pill.label}</span>
}
