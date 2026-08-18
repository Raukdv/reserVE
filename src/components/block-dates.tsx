'use client'

import { useActionState, useState } from 'react'
import { createBlock, releaseBlock, type BlockState } from '@/app/admin/calendario/actions'

export type ActiveBlock = {
  holdId: string
  unitName: string
  from: string
  to: string
  reason: string | null
}

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

const shortDate = new Intl.DateTimeFormat('es-VE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const label = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`))

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function BlockDates({
  units,
  blocks,
  today,
}: {
  units: { id: string; name: string }[]
  blocks: ActiveBlock[]
  today: string
}) {
  const [state, action, pending] = useActionState<BlockState, FormData>(createBlock, {})
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // El rango es semiabierto: fin debe ser posterior a inicio, o no se bloquea
  // ninguna noche.
  function changeFrom(value: string) {
    setFrom(value)
    if (value && (!to || to <= value)) setTo(addDays(value, 1))
  }

  return (
    <section className="mt-6 rounded-2xl border border-ink/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm"
      >
        <span className="font-medium">Bloquear fechas</span>
        <span className="flex items-center gap-3 text-ink/60">
          {blocks.length > 0 && (
            <span className="text-xs">
              {blocks.length} bloqueo{blocks.length > 1 ? 's' : ''} activo
              {blocks.length > 1 ? 's' : ''}
            </span>
          )}
          <span className={`transition ${open ? 'rotate-45' : ''}`}>+</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-ink/10 p-5">
          <form action={action} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Unidad</span>
              <select name="unitId" required className={field} defaultValue="">
                <option value="" disabled>
                  Elegir…
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Desde</span>
              <input
                name="from"
                type="date"
                required
                value={from}
                onChange={(e) => changeFrom(e.target.value)}
                className={field}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Hasta</span>
              <input
                name="to"
                type="date"
                required
                value={to}
                min={from ? addDays(from, 1) : today}
                onChange={(e) => setTo(e.target.value)}
                className={field}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Motivo</span>
              <input
                name="reason"
                placeholder="Mantenimiento, uso personal…"
                className={field}
              />
            </label>

            <button
              type="submit"
              disabled={pending}
              className="self-end rounded-lg bg-ink px-5 py-2 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
            >
              {pending ? 'Bloqueando…' : 'Bloquear'}
            </button>
          </form>

          <p className="mt-3 text-xs text-ink/60">
            La noche de fin queda libre: bloquear del 10 al 14 inutiliza las noches 10, 11,
            12 y 13, y el 14 se puede vender como entrada.
          </p>

          {state.error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {state.error}
            </p>
          )}
          {state.ok && <p className="mt-3 text-sm text-moss">{state.ok}</p>}

          {blocks.length > 0 && (
            <>
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink/60">
                Bloqueos activos
              </h3>
              <ul className="mt-2 divide-y divide-ink/8">
                {blocks.map((b) => (
                  <BlockRow key={b.holdId} block={b} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function BlockRow({ block }: { block: ActiveBlock }) {
  const [state, action, pending] = useActionState<BlockState, FormData>(releaseBlock, {})

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
      <span>
        <strong className="font-medium">{block.unitName}</strong>{' '}
        <span className="text-ink/70">
          {label(block.from)} → {label(block.to)}
        </span>
        {block.reason && <span className="text-ink/60"> · {block.reason}</span>}
      </span>

      <span className="flex items-center gap-3">
        {state.error && <span className="text-xs text-red-700">{state.error}</span>}
        <form action={action}>
          <input type="hidden" name="holdId" value={block.holdId} />
          <button
            disabled={pending}
            className="text-xs text-ink/70 underline hover:text-ink disabled:opacity-50"
          >
            {pending ? 'Liberando…' : 'Liberar'}
          </button>
        </form>
      </span>
    </li>
  )
}
