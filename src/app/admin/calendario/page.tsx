import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { parseRange } from '@/lib/format'
import { businessToday } from '@/lib/business-date'
import { BlockDates, type ActiveBlock } from '@/components/block-dates'
import { CalendarGrid, DAY_WIDTH, type Bar, type Day } from '@/components/calendar-grid'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Calendario' }

const DAYS = 45

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
  block: 'bg-ink/15 text-ink/70',
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const offsetRaw = Array.isArray(sp.offset) ? sp.offset[0] : sp.offset
  const offset = Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : 0

  // La rejilla arranca en el día del negocio, no en el de UTC: entre las 8 de
  // la noche y la medianoche los dos no coinciden, y el calendario se abriría
  // con la columna de «hoy» puesta en mañana.
  const today = new Date(`${businessToday()}T00:00:00Z`)
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

  // Una barra por estadía, ya recortada a la ventana visible. Antes esto era un
  // índice día a día porque cada celda se pintaba por separado; con las barras
  // desplazadas media columna eso deja de servir: media celda pertenece a una
  // estadía y media a la siguiente.
  const bars: Bar[] = []

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

    const rangeStart = new Date(`${from}T00:00:00Z`)
    const rangeEnd = new Date(`${to}T00:00:00Z`)
    const visibleStart = rangeStart < start ? start : rangeStart
    const visibleEnd = rangeEnd > end ? end : rangeEnd

    const span = Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 86_400_000)
    if (span <= 0) continue

    bars.push({
      unitId: hold.unit_id,
      offset: Math.round((visibleStart.getTime() - start.getTime()) / 86_400_000),
      span,
      tone: TONE[status] ?? TONE.block,
      label: text,
      title: `${text} · ${from} → ${to}`,
      href: booking ? `/admin/reservas/${booking.code}` : '/admin/calendario',
      openStart: rangeStart >= start,
      openEnd: rangeEnd <= end,
    })
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

  const gridDays: Day[] = days.map((d) => ({
    key: iso(d),
    letter: dayLetter.format(d),
    num: dayNum.format(d),
    weekend: [0, 6].includes(d.getUTCDay()),
  }))

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="mt-1 text-descripcion text-ink/70">{DAYS} días desde el {iso(start)}</p>
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

      <div className="mt-5 flex flex-wrap gap-4 text-xs text-ink/70">
        <Legend tone={TONE.pending} label="Pendiente de pago" />
        <Legend tone={TONE.confirmed} label="Confirmada" />
        <Legend tone={TONE.checked_in} label="Hospedado" />
        <Legend tone={TONE.block} label="Bloqueo manual" />
      </div>

      <BlockDates units={units ?? []} blocks={blocks} today={todayIso} />

      {/*
        La fila de meses se queda aquí porque no participa del arrastre; la
        rejilla pasa a ser cliente para poder dibujar bloqueos sobre ella.
      */}
      <div className="mt-6 overflow-x-auto">
        <div className="flex min-w-max border-b border-ink/10 pb-1">
          <div className="w-44 shrink-0" />
          {monthSpans.map((m) => (
            <div
              key={m.name}
              className="border-l border-ink/10 px-2 text-xs text-ink/70 first-letter:uppercase"
              style={{ width: `${m.span * DAY_WIDTH}px` }}
            >
              {m.name}
            </div>
          ))}
        </div>
      </div>

      <CalendarGrid
        units={(units ?? []).map((u) => ({ id: u.id, name: u.name }))}
        days={gridDays}
        bars={bars}
        todayIso={todayIso}
      />

      {(units ?? []).length === 0 && (
        <p className="mt-6 text-descripcion text-ink/70">No hay unidades creadas todavía.</p>
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
