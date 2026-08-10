'use client'

import { useActionState } from 'react'
import { setAmenities, type UnitState } from '@/app/admin/unidades/actions'

export function UnitAmenities({
  unitId,
  amenities,
  selected,
}: {
  unitId: string
  amenities: { id: string; label: string }[]
  selected: string[]
}) {
  const [state, action, pending] = useActionState<UnitState, FormData>(setAmenities, {})

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-sm font-medium">Amenidades</h2>
      <p className="mt-1 text-sm text-ink/50">Se listan en la ficha del alojamiento.</p>

      <form action={action} className="mt-5">
        <input type="hidden" name="unitId" value={unitId} />

        <div className="grid gap-2 sm:grid-cols-2">
          {amenities.map((a) => (
            <label key={a.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="amenity"
                value={a.id}
                defaultChecked={selected.includes(a.id)}
                className="h-4 w-4"
              />
              {a.label}
            </label>
          ))}
        </div>

        {amenities.length === 0 && (
          <p className="text-sm text-ink/45">No hay amenidades definidas todavía.</p>
        )}

        <div className="mt-5 flex items-center gap-4">
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
