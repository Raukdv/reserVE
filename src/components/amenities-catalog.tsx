'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  saveAmenity,
  deleteAmenity,
  type AmenityState,
} from '@/app/admin/amenidades/actions'
import {
  AMENITY_CATEGORIES,
  ICON_NAMES,
  categoryLabel,
  groupByCategory,
  type Amenity,
} from '@/lib/amenities'
import { AmenityIcon } from '@/components/amenity-icon'

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

/** Catálogo completo, con búsqueda y alta. */
export function AmenitiesCatalog({
  amenities,
  usage,
}: {
  amenities: Amenity[]
  /** Cuántas unidades usan cada amenidad, por id. */
  usage: Record<string, number>
}) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return amenities
    return amenities.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        categoryLabel(a.category).toLowerCase().includes(q),
    )
  }, [amenities, query])

  const groups = groupByCategory(filtered)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block w-full max-w-xs">
          <span className="mb-1 block text-xs font-medium text-ink">Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="WiFi, piscina, planta…"
            className={field}
          />
        </label>

        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40"
        >
          {adding ? 'Cancelar' : 'Añadir amenidad'}
        </button>
      </div>

      {adding && (
        <div className="mt-4 rounded-2xl border border-ink/15 bg-white p-5">
          <p className="mb-3 text-sm font-medium">Nueva amenidad</p>
          <AmenityForm onDone={() => setAdding(false)} />
        </div>
      )}

      {groups.length > 0 ? (
        <div className="mt-6 space-y-6">
          {groups.map((group) => (
            <section key={group.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">
                {group.label}
              </h3>
              <ul className="mt-3 space-y-2">
                {group.items.map((amenity) => (
                  <AmenityRow
                    key={amenity.id}
                    amenity={amenity}
                    usedBy={usage[amenity.id] ?? 0}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-ink/20 p-10 text-center text-sm text-ink/70">
          {query ? 'Ninguna amenidad coincide.' : 'El catálogo está vacío.'}
        </p>
      )}
    </div>
  )
}

function AmenityRow({ amenity, usedBy }: { amenity: Amenity; usedBy: number }) {
  const [editing, setEditing] = useState(false)
  const [state, remove, removing] = useActionState<AmenityState, FormData>(
    deleteAmenity,
    {},
  )

  return (
    <li className="rounded-xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-3 text-sm">
          <AmenityIcon name={amenity.icon} />
          {amenity.label}
          {usedBy > 0 && (
            <span className="text-xs text-ink/60">
              en {usedBy} unidad{usedBy === 1 ? '' : 'es'}
            </span>
          )}
        </span>

        <span className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-ink/70 underline hover:text-ink"
          >
            {editing ? 'Cerrar' : 'Editar'}
          </button>

          <form action={remove}>
            <input type="hidden" name="id" value={amenity.id} />
            {/*
              Segundo envío con confirmación: la primera vez el servidor avisa de
              cuántas unidades la usan, y solo entonces aparece esta casilla.
            */}
            {state.needsForce && <input type="hidden" name="force" value="on" />}
            <button
              disabled={removing}
              className="text-ink/60 underline hover:text-red-700 disabled:opacity-50"
            >
              {removing ? '…' : state.needsForce ? 'Borrar igualmente' : 'Eliminar'}
            </button>
          </form>
        </span>
      </div>

      {state.error && (
        <p className="border-t border-ink/10 px-4 py-2 text-xs text-red-700">
          {state.error}
        </p>
      )}

      {editing && (
        <div className="border-t border-ink/10 p-4">
          <AmenityForm amenity={amenity} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  )
}

function AmenityForm({ amenity, onDone }: { amenity?: Amenity; onDone: () => void }) {
  const [state, action, pending] = useActionState<AmenityState, FormData>(saveAmenity, {})
  const [icon, setIcon] = useState(amenity?.icon ?? '')

  if (state.ok) queueMicrotask(onDone)

  return (
    <form action={action} className="space-y-3">
      {amenity && <input type="hidden" name="id" value={amenity.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink">Nombre</span>
          <input
            name="label"
            required
            defaultValue={amenity?.label}
            placeholder="Hamaca en la terraza"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Categoría</span>
          <select
            name="category"
            defaultValue={amenity?.category ?? 'otros'}
            className={field}
          >
            {AMENITY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Orden</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={99}
            defaultValue={amenity?.sort_order ?? 0}
            className={field}
          />
        </label>
      </div>

      <div>
        <span className="mb-2 flex items-center gap-2 text-xs text-ink/70">
          Icono
          <AmenityIcon name={icon || null} className="h-4 w-4 text-ink/70" />
        </span>
        <input type="hidden" name="icon" value={icon} />

        <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-lg border border-ink/10 p-2">
          <button
            type="button"
            onClick={() => setIcon('')}
            className={`rounded-md px-2 py-1 text-xs ${
              icon === '' ? 'bg-ink text-sand' : 'text-ink/70 hover:bg-ink/5'
            }`}
          >
            Sin icono
          </button>
          {ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => setIcon(name)}
              className={`rounded-md p-1.5 ${
                icon === name ? 'bg-ink text-sand' : 'text-ink/70 hover:bg-ink/5'
              }`}
            >
              <AmenityIcon name={name} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
        >
          {pending ? 'Guardando…' : amenity ? 'Guardar' : 'Añadir'}
        </button>
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  )
}
