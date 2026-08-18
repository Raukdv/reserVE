'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { setAmenities, type UnitState } from '@/app/admin/unidades/actions'
import { categoryLabel, groupByCategory, type Amenity } from '@/lib/amenities'
import { AmenityIcon } from '@/components/amenity-icon'

/**
 * Selector de amenidades de una unidad.
 *
 * Agrupado y con búsqueda porque el catálogo pasa de treinta: una lista plana de
 * casillas obliga a recorrerla entera para encontrar una.
 */
export function UnitAmenities({
  unitId,
  amenities,
  selected,
}: {
  unitId: string
  amenities: Amenity[]
  selected: string[]
}) {
  const [state, action, pending] = useActionState<UnitState, FormData>(setAmenities, {})
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<string[]>(selected)

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

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Amenidades</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            {checked.length} marcada{checked.length === 1 ? '' : 's'} de {amenities.length}.
            Se listan en la ficha del alojamiento.
          </p>
        </div>
        <Link href="/admin/amenidades" className="text-sm text-ink/70 underline">
          Editar catálogo
        </Link>
      </div>

      <form action={action} className="mt-5">
        <input type="hidden" name="unitId" value={unitId} />
        {/*
          Las marcadas viajan en campos ocultos y no en las casillas visibles:
          al filtrar, una casilla oculta dejaría de enviarse y se perdería la
          selección sin que nadie la tocara.
        */}
        {checked.map((id) => (
          <input key={id} type="hidden" name="amenity" value={id} />
        ))}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar amenidad…"
          className="w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40"
        />

        {groups.length > 0 ? (
          <div className="mt-5 space-y-5">
            {groups.map((group) => (
              <div key={group.category}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/60">
                  {group.label}
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.items.map((amenity) => {
                    const on = checked.includes(amenity.id)
                    return (
                      <button
                        key={amenity.id}
                        type="button"
                        onClick={() => toggle(amenity.id)}
                        aria-pressed={on}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                          on
                            ? 'border-ink/40 bg-ink/5'
                            : 'border-ink/10 hover:border-ink/25'
                        }`}
                      >
                        <AmenityIcon
                          name={amenity.icon}
                          className={`h-4 w-4 ${on ? 'text-ink' : 'text-ink/60'}`}
                        />
                        <span className={on ? '' : 'text-ink/70'}>{amenity.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-ink/60">
            {query ? 'Ninguna coincide.' : 'No hay amenidades en el catálogo.'}
          </p>
        )}

        <div className="mt-6 flex items-center gap-4">
          <button
            disabled={pending}
            className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
          >
            {pending ? 'Guardando…' : 'Guardar amenidades'}
          </button>
          {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
          {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        </div>
      </form>
    </section>
  )
}
