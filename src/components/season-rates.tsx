'use client'

import { useActionState, useState } from 'react'
import {
  saveSeason,
  deleteSeason,
  copySeasons,
  type RateState,
} from '@/app/admin/tarifas/actions'
import { usd, dateLabel } from '@/lib/format'

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

export type Season = {
  id: string
  name: string
  from: string
  to: string
  priceUsd: number
  minNights: number | null
}

export type UnitRates = {
  id: string
  name: string
  basePriceUsd: number
  minNights: number
  seasons: Season[]
}

export function SeasonRates({ units }: { units: UnitRates[] }) {
  return (
    <div className="space-y-5">
      {units.map((unit) => (
        <UnitPanel key={unit.id} unit={unit} others={units.filter((u) => u.id !== unit.id)} />
      ))}
    </div>
  )
}

function UnitPanel({ unit, others }: { unit: UnitRates; others: UnitRates[] }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{unit.name}</h2>
          <p className="mt-1 text-sm text-ink/55">
            Tarifa base {usd(unit.basePriceUsd)} / noche · mínimo {unit.minNights} noche
            {unit.minNights > 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v)
            setEditing(null)
          }}
          className="rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40"
        >
          {adding ? 'Cancelar' : 'Añadir temporada'}
        </button>
      </div>

      {adding && (
        <div className="mt-4 rounded-xl border border-ink/15 p-4">
          <SeasonForm unitId={unit.id} onDone={() => setAdding(false)} />
        </div>
      )}

      {unit.seasons.length > 0 ? (
        <ul className="mt-4 divide-y divide-ink/8">
          {unit.seasons.map((season) => (
            <li key={season.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  <strong className="font-medium">{season.name}</strong>
                  <span className="ml-2 text-ink/55">
                    {dateLabel(season.from)} — {dateLabel(season.to)}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-medium">{usd(season.priceUsd)}</span>
                  {season.minNights && (
                    <span className="text-xs text-ink/45">mín. {season.minNights}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(editing === season.id ? null : season.id)}
                    className="text-ink/55 underline"
                  >
                    {editing === season.id ? 'Cerrar' : 'Editar'}
                  </button>
                  <DeleteSeason id={season.id} />
                </span>
              </div>

              {editing === season.id && (
                <div className="mt-3 rounded-xl border border-ink/15 p-4">
                  <SeasonForm
                    unitId={unit.id}
                    season={season}
                    onDone={() => setEditing(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink/45">
          Sin temporadas. Se cobra siempre la tarifa base.
        </p>
      )}

      {unit.seasons.length > 0 && others.length > 0 && (
        <CopySeasons sourceId={unit.id} others={others} />
      )}
    </section>
  )
}

function SeasonForm({
  unitId,
  season,
  onDone,
}: {
  unitId: string
  season?: Season
  onDone: () => void
}) {
  const [state, action, pending] = useActionState<RateState, FormData>(saveSeason, {})
  const [from, setFrom] = useState(season?.from ?? '')

  if (state.ok) queueMicrotask(onDone)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="unitId" value={unitId} />
      {season && <input type="hidden" name="id" value={season.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs text-ink/50">Nombre</span>
          <input
            name="name"
            required
            defaultValue={season?.name}
            placeholder="Temporada alta — Carnaval"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Desde</span>
          <input
            name="from"
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Hasta</span>
          <input
            name="to"
            type="date"
            required
            defaultValue={season?.to}
            min={from || undefined}
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Precio / noche</span>
          <input
            name="price"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={season?.priceUsd}
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Mínimo de noches</span>
          <input
            name="minNights"
            type="number"
            min={0}
            defaultValue={season?.minNights ?? 0}
            className={field}
          />
          <span className="mt-1 block text-xs text-ink/45">0 = el de la unidad</span>
        </label>
      </div>

      <p className="text-xs text-ink/45">
        La noche de fin no se incluye: del 15 de diciembre al 8 de enero cubre hasta la
        noche del 7.
      </p>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        disabled={pending}
        className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
      >
        {pending ? 'Guardando…' : season ? 'Guardar' : 'Añadir'}
      </button>
    </form>
  )
}

function DeleteSeason({ id }: { id: string }) {
  const [state, action, pending] = useActionState<RateState, FormData>(deleteSeason, {})

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        disabled={pending}
        className="text-ink/40 underline hover:text-red-700 disabled:opacity-50"
      >
        {pending ? '…' : 'Borrar'}
      </button>
      {state.error && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  )
}

/**
 * Copia las temporadas a otras unidades.
 *
 * Una posada suele tener las mismas fechas altas en todas sus unidades y solo
 * cambia el precio. Cargarlas a mano cuatro veces es donde se cuelan los errores.
 */
function CopySeasons({ sourceId, others }: { sourceId: string; others: UnitRates[] }) {
  const [state, action, pending] = useActionState<RateState, FormData>(copySeasons, {})
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-5 border-t border-ink/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink/55 underline hover:text-ink"
      >
        {open ? 'Cerrar' : 'Copiar estas temporadas a otras unidades'}
      </button>

      {open && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="sourceId" value={sourceId} />
          <div className="grid gap-2 sm:grid-cols-2">
            {others.map((u) => (
              <label key={u.id} className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="target" value={u.id} className="h-4 w-4" />
                {u.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink/45">
            Se copian con el mismo precio; ajústalo después en cada unidad. Las que se
            solapen con temporadas ya existentes se saltan.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={pending}
              className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
            >
              {pending ? 'Copiando…' : 'Copiar'}
            </button>
            {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
            {state.error && <span className="text-sm text-red-700">{state.error}</span>}
          </div>
        </form>
      )}
    </div>
  )
}
