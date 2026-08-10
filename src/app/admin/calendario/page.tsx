import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { parseRange } from '@/lib/format'
import { BlockDates, type ActiveBlock } from '@/components/block-dates'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Calendario' }

const DAYS = 45

/** Ancho de una columna de día, en píxeles. Compartido por cabeceras y barras. */
const DAY_WIDTH = 28

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => {
  const c = new Date(d)
  c.setUTCDate(c.getUTCDate() + n)
  return c
}

const dayNum = new Intl.DateTimeFormat('es-VE', { day: 'numeric', timeZone: 'UTC' })
const dayLetter = new Intl.DateTimeFormat('es-VE', { weekday: 'narrow', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('es-VE', { month: 'long', timeZone: 'UTC' })

// Color por naturaleza de la ocupación, no por unidad: el operador escanea la
// rejilla buscando qué requiere acción frente a qué ya está cerrado.
//
// El ámbar es el único que reclama atención, porque "pendiente de pago" es el
// único estado que exige hacer algo. Confirmada y hospedado son informativos, así
// que se separan por TONO —verde contra azul petróleo— y no por intensidad: dos
// variantes del mismo verde no se distinguen en una barra de 28px, y oscurecer
// una la pondría a competir con el ámbar.
const TONE: Record<string, string> = {
  pending: 'bg-amber-300/80 text-amber-950',
  confirmed: 'bg-moss text-white',
  checked_in: 'bg-tide text-white',
  completed: 'bg-ink/25 text-ink',
  block: 'bg-ink/15 text-ink/60',
}

type Cell = {
  tone: string
  title: string
  href: string
  /** Solo en la primera celda visible de la barra: texto y ancho de la etiqueta. */
  label: string | null
  span: number
  roundedStart: boolean
  roundedEnd: boolean
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const offsetRaw = Array.isArray(sp.offset) ? sp.offset[0] : sp.offset
  const offset = Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : 0

  const today = new Date(`${iso(new Date())}T00:00:00Z`)
  const start = addDays(today, offset * DAYS)
  const end = addDays(start, DAYS)
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i))

  const supabase = await createClient()

  const [{ data: units }, { data: holds }, { data: blockRows }] = await Promise.all([
    supabase.from('units').select('id, name, slug').order('sort_order'),
    supabase
      .from('unit_holds')
      .select(`
        id, unit_id, stay, kind,
        bookings ( id, code, status, guest_name, guests ),
        availability_blocks ( reason )
      `)
      .eq('is_active', true)
      .overlaps('stay', `[${iso(start)},${iso(end)})`),
    // Bloqueos vigentes o futuros, para poder liberarlos desde el panel.
    supabase
      .from('unit_holds')
      .select('id, stay, units ( name ), availability_blocks ( reason )')
      .eq('is_active', true)
      .eq('kind', 'block')
      .order('stay'),
  ])

  // Índice unit_id → día ISO → qué ocupa ese día. Se construye una vez para no
  // recorrer los holds dentro del doble bucle de la rejilla.
  const grid = new Map<string, Map<string, Cell>>()

  for (const hold of holds ?? []) {
    const booking = Array.isArray(hold.bookings) ? hold.bookings[0] : hold.bookings
    const block = Array.isArray(hold.availability_blocks)
      ? hold.availability_blocks[0]
      : hold.availability_blocks

    const { from, to } = parseRange(hold.stay)
    const status = hold.kind === 'block' ? 'block' : booking?.status ?? 'pending'

    const text = hold.kind === 'block'
      ? block?.reason ?? 'Bloqueado'
      : booking?.guest_name ?? 'Reserva'

    const href = booking ? `/admin/reservas/${booking.code}` : '/admin/calendario'

    // La estadía puede empezar antes de la ventana o terminar después. Se recorta
    // para que la etiqueta caiga en la primera celda VISIBLE, no en una que está
    // fuera de pantalla, y para que el ancho de la etiqueta no se pase de largo.
    const rangeStart = new Date(`${from}T00:00:00Z`)
    const rangeEnd = new Date(`${to}T00:00:00Z`)
    const visibleStart = rangeStart < start ? start : rangeStart
    const visibleEnd = rangeEnd > end ? end : rangeEnd

    const span = Math.round(
      (visibleEnd.getTime() - visibleStart.getTime()) / 86_400_000,
    )
    if (span <= 0) continue

    if (!grid.has(hold.unit_id)) grid.set(hold.unit_id, new Map())
    const row = grid.get(hold.unit_id)!

    const cursor = new Date(visibleStart)
    let index = 0
    while (cursor < visibleEnd) {
      const key = iso(cursor)
      row.set(key, {
        tone: TONE[status] ?? TONE.block,
        title: text,
        href,
        label: index === 0 ? text : null,
        span,
        roundedStart: index === 0 && rangeStart >= start,
        roundedEnd:
          iso(addDays(cursor, 1)) === iso(visibleEnd) && rangeEnd <= end,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      index++
    }
  }

  const blocks: ActiveBlock[] = (blockRows ?? [])
    .map((b) => {
      const unit = Array.isArray(b.units) ? b.units[0] : b.units
      const detail = Array.isArray(b.availability_blocks)
        ? b.availability_blocks[0]
        : b.availability_blocks
      const { from, to } = parseRange(b.stay)
      return {
        holdId: b.id,
        unitName: unit?.name ?? '—',
        from,
        to,
        reason: detail?.reason ?? null,
      }
    })
    .filter((b) => b.to >= iso(today))

  // Cabeceras de mes: cuántos días del rango caen en cada mes.
  const monthSpans: { name: string; span: number }[] = []
  for (const d of days) {
    const name = monthLabel.format(d)
    const last = monthSpans[monthSpans.length - 1]
    if (last && last.name === name) last.span++
    else monthSpans.push({ name, span: 1 })
  }

  const todayIso = iso(today)

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-ink/50">{DAYS} días desde el {iso(start)}</p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/admin/calendario?offset=${offset - 1}`}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
          >
            ←
          </Link>
          <Link
            href="/admin/calendario"
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
          >
            Hoy
          </Link>
          <Link
            href={`/admin/calendario?offset=${offset + 1}`}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 hover:border-ink/35"
          >
            →
          </Link>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-xs text-ink/60">
        <Legend tone={TONE.pending} label="Pendiente de pago" />
        <Legend tone={TONE.confirmed} label="Confirmada" />
        <Legend tone={TONE.checked_in} label="Hospedado" />
        <Legend tone={TONE.block} label="Bloqueo manual" />
      </div>

      <BlockDates units={units ?? []} blocks={blocks} today={todayIso} />

      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/10 bg-white">
        <div className="min-w-max">
          {/* Meses */}
          <div className="flex border-b border-ink/10">
            <div className="w-44 shrink-0 border-r border-ink/10" />
            {monthSpans.map((m) => (
              <div
                key={m.name}
                className="border-r border-ink/10 px-2 py-1.5 text-xs capitalize text-ink/50"
                style={{ width: `${m.span * DAY_WIDTH}px` }}
              >
                {m.name}
              </div>
            ))}
          </div>

          {/* Días */}
          <div className="flex border-b border-ink/10">
            <div className="w-44 shrink-0 border-r border-ink/10 px-3 py-2 text-xs font-medium text-ink/50">
              Unidad
            </div>
            {days.map((d) => {
              const key = iso(d)
              const weekend = [0, 6].includes(d.getUTCDay())
              return (
                <div
                  key={key}
                  className={`w-7 shrink-0 py-1 text-center text-[10px] leading-tight ${
                    key === todayIso ? 'bg-clay/20 font-semibold' : weekend ? 'bg-ink/3' : ''
                  }`}
                >
                  <div className="text-ink/35">{dayLetter.format(d)}</div>
                  <div>{dayNum.format(d)}</div>
                </div>
              )
            })}
          </div>

          {/* Filas */}
          {(units ?? []).map((unit) => (
            <div key={unit.id} className="flex border-b border-ink/8 last:border-b-0">
              <div className="w-44 shrink-0 truncate border-r border-ink/10 px-3 py-2.5 text-sm">
                {unit.name}
              </div>

              {days.map((d) => {
                const key = iso(d)
                const cell = grid.get(unit.id)?.get(key)
                const weekend = [0, 6].includes(d.getUTCDay())

                if (!cell) {
                  return (
                    <div
                      key={key}
                      className={`h-11 w-7 shrink-0 border-r border-ink/5 ${
                        key === todayIso ? 'bg-clay/10' : weekend ? 'bg-ink/3' : ''
                      }`}
                    />
                  )
                }

                return (
                  <Link
                    key={key}
                    href={cell.href}
                    title={cell.title}
                    className={`relative h-11 w-7 shrink-0 border-r border-white/25 ${cell.tone} ${
                      cell.roundedStart ? 'rounded-l-md' : ''
                    } ${cell.roundedEnd ? 'rounded-r-md' : ''}`}
                  >
                    {/*
                      La etiqueta se posiciona en absoluto y se extiende sobre toda
                      la barra. Dentro de la celda de 28px se truncaría a un par de
                      caracteres aunque la barra ocupe cuatro noches.
                    */}
                    {cell.label && (
                      <span
                        className="pointer-events-none absolute left-1.5 top-1/2 z-10 -translate-y-1/2 truncate text-[10px] font-medium leading-none"
                        style={{ width: `${cell.span * DAY_WIDTH - 12}px` }}
                      >
                        {cell.label}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {(units ?? []).length === 0 && (
        <p className="mt-6 text-sm text-ink/50">No hay unidades creadas todavía.</p>
      )}
    </main>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-3 w-6 rounded ${tone}`} />
      {label}
    </span>
  )
}
