import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { usd, dateLabel } from '@/lib/format'
import type { BookingStatus } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reservas' }

/**
 * Tamaño de página.
 *
 * Toda lista lleva tope: cada fila es renderizado en el servidor y el plan Hobby
 * incluye 4 CPU-horas al mes. Ver docs/COSTO-CERO.md, regla 3.8.
 */
const PER_PAGE = 25

const ISO = /^\d{4}-\d{2}-\d{2}$/

const STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'bg-amber-100 text-amber-900' },
  confirmed: { label: 'Confirmada', tone: 'bg-moss/15 text-moss' },
  checked_in: { label: 'Hospedado', tone: 'bg-tide/15 text-tide' },
  completed: { label: 'Completada', tone: 'bg-ink/8 text-ink/70' },
  cancelled: { label: 'Cancelada', tone: 'bg-ink/8 text-ink/70' },
  no_show: { label: 'No se presentó', tone: 'bg-ink/8 text-ink/70' },
  expired: { label: 'Expirada', tone: 'bg-ink/8 text-ink/70' },
}

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  }

  // Se valida contra la tabla de estados antes de tocar la consulta: lo que
  // llega por la URL no puede ser cualquier cosa.
  const estadoRaw = one('estado')
  const estado =
    estadoRaw && estadoRaw in STATUS ? (estadoRaw as BookingStatus) : undefined

  const unidad = one('unidad')
  const desde = ISO.test(one('desde') ?? '') ? one('desde')! : undefined
  const hasta = ISO.test(one('hasta') ?? '') ? one('hasta')! : undefined
  const q = one('q')
  const page = Math.max(1, Number(one('pagina')) || 1)

  const supabase = await createClient()

  let query = supabase
    .from('bookings')
    .select(
      `code, status, check_in, check_out, nights, guests, guest_name, guest_email,
       total_usd, created_at, units ( name )`,
      { count: 'exact' },
    )

  if (estado) query = query.eq('status', estado)
  if (unidad) query = query.eq('unit_id', unidad)

  // Solapamiento, no contención: una estadía cuenta si toca el rango buscado,
  // aunque empiece antes o termine después.
  if (desde) query = query.gt('check_out', desde)
  if (hasta) query = query.lt('check_in', hasta)

  if (q) {
    const term = `%${q}%`
    query = query.or(
      `code.ilike.${term},guest_name.ilike.${term},guest_email.ilike.${term}`,
    )
  }

  const from = (page - 1) * PER_PAGE

  const [{ data: bookings, count }, { data: units }] = await Promise.all([
    query.order('check_in', { ascending: false }).range(from, from + PER_PAGE - 1),
    supabase.from('units').select('id, name').order('sort_order'),
  ])

  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  // Conserva los filtros al cambiar de página.
  const pageHref = (n: number) => {
    const params = new URLSearchParams()
    if (estado) params.set('estado', estado)
    if (unidad) params.set('unidad', unidad)
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    if (q) params.set('q', q)
    if (n > 1) params.set('pagina', String(n))
    const s = params.toString()
    return s ? `/admin/reservas?${s}` : '/admin/reservas'
  }

  const filtered = Boolean(estado || unidad || desde || hasta || q)

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reservas</h1>
          <p className="mt-1 text-descripcion text-ink/70">
            {total} {total === 1 ? 'reserva' : 'reservas'}
            {filtered ? ' con estos filtros' : ' en total'}
          </p>
        </div>

        <Link
          href="/admin/reservas/nueva"
          className="rounded-xl bg-ink px-5 py-2.5 text-sm text-sand transition hover:bg-ink/85"
        >
          Nueva reserva
        </Link>
      </div>

      {/*
        Formulario GET sin JavaScript: los filtros viven en la URL, así que se
        pueden compartir y marcar, y no hace falta un componente cliente.
      */}
      <form
        method="get"
        className="mt-6 grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink">Buscar</span>
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Código, nombre o correo"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Estado</span>
          <select name="estado" defaultValue={estado ?? ''} className={field}>
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Unidad</span>
          <select name="unidad" defaultValue={unidad ?? ''} className={field}>
            <option value="">Todas</option>
            {(units ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Entra desde</span>
          <input name="desde" type="date" defaultValue={desde ?? ''} className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Sale antes de</span>
          <input name="hasta" type="date" defaultValue={hasta ?? ''} className={field} />
        </label>

        <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-6">
          <button className="rounded-lg bg-ink px-5 py-2 text-sm text-sand transition hover:bg-ink/85">
            Filtrar
          </button>
          {filtered && (
            <Link href="/admin/reservas" className="text-sm text-ink/70 hover:underline">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {bookings && bookings.length > 0 ? (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/10 bg-white">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink/60">
                  <th className="px-5 py-3 font-normal">Código</th>
                  <th className="px-5 py-3 font-normal">Huésped</th>
                  <th className="px-5 py-3 font-normal">Unidad</th>
                  <th className="px-5 py-3 font-normal">Estadía</th>
                  <th className="px-5 py-3 text-right font-normal">Total</th>
                  <th className="px-5 py-3 text-right font-normal">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8">
                {bookings.map((b) => {
                  const unit = Array.isArray(b.units) ? b.units[0] : b.units
                  const pill = STATUS[b.status]

                  return (
                    <tr key={b.code} className="cursor-pointer hover:bg-sand/60">
                      {/*
                        El enlace se estira sobre la fila desde la primera celda:
                        envolver un <tr> en <a> no es HTML válido.
                      */}
                      <td className="relative px-5 py-3 font-mono text-xs">
                        <Link
                          href={`/admin/reservas/${b.code}`}
                          className="absolute inset-0"
                          aria-label={`Ver reserva ${b.code}`}
                        />
                        {b.code}
                      </td>
                      <td className="px-5 py-3">
                        {b.guest_name}
                        <span className="mt-0.5 block text-xs text-ink/60">
                          {b.guest_email}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-ink/70">{unit?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-ink/70">
                        {dateLabel(b.check_in)} → {dateLabel(b.check_out)}
                        <span className="mt-0.5 block text-xs text-ink/60">
                          {b.nights} noche{b.nights > 1 ? 's' : ''} · {b.guests} huésped
                          {b.guests > 1 ? 'es' : ''}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">{usd(b.total_usd)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${pill.tone}`}>
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="mt-5 flex items-center justify-between text-sm">
              <span className="text-ink/70">
                Página {page} de {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
                  >
                    ←
                  </Link>
                )}
                {page < pages && (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
                  >
                    →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/70">
          {filtered
            ? 'Ninguna reserva coincide con esos filtros.'
            : 'Todavía no hay reservas.'}
        </p>
      )}

    </main>
  )
}
