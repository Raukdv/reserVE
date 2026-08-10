import { parseRange } from '@/lib/format'

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const monthName = new Intl.DateTimeFormat('es-VE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Expande los daterange ocupados a un conjunto de días.
 *
 * El límite superior es exclusivo, así que el día de salida NO se marca: esa
 * noche está libre y otro huésped puede entrar ese mismo día.
 */
export function occupiedDays(ranges: string[]): Set<string> {
  const days = new Set<string>()
  for (const range of ranges) {
    const { from, to } = parseRange(range)
    const cursor = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    while (cursor < end) {
      days.add(iso(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return days
}

function Month({ year, month, occupied }: { year: number; month: number; occupied: Set<string> }) {
  const first = new Date(Date.UTC(year, month, 1))
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  // getUTCDay(): domingo = 0. La rejilla empieza en lunes.
  const leading = (first.getUTCDay() + 6) % 7
  const today = iso(new Date())

  return (
    <div>
      {/*
        first-letter y no capitalize: `capitalize` pone mayúscula en cada palabra
        y deja «Agosto De 2026».
      */}
      <p className="mb-3 text-sm font-medium first-letter:uppercase">
        {monthName.format(first)}
      </p>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1 text-ink/35">{d}</span>
        ))}

        {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = iso(new Date(Date.UTC(year, month, i + 1)))
          const busy = occupied.has(date)
          const past = date < today

          return (
            <span
              key={date}
              title={busy ? 'Ocupado' : past ? '' : 'Libre'}
              className={[
                'rounded-md py-1.5',
                past
                  ? 'text-ink/20'
                  : busy
                    ? 'bg-ink/15 text-ink/40 line-through'
                    : 'bg-white text-ink',
              ].join(' ')}
            >
              {i + 1}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function AvailabilityCalendar({
  ranges,
  months = 3,
}: {
  ranges: string[]
  months?: number
}) {
  const occupied = occupiedDays(ranges)
  const now = new Date()

  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: months }, (_, i) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
        return (
          <Month
            key={i}
            year={d.getUTCFullYear()}
            month={d.getUTCMonth()}
            occupied={occupied}
          />
        )
      })}
    </div>
  )
}
