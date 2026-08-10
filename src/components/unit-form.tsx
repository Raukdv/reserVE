'use client'

import { useActionState } from 'react'
import { saveUnit, type UnitState } from '@/app/admin/unidades/actions'
import type { Row } from '@/types/database'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

export function UnitForm({ unit }: { unit?: Row<'units'> }) {
  const [state, action, pending] = useActionState<UnitState, FormData>(saveUnit, {})

  return (
    <form action={action} className="space-y-8">
      {unit && <input type="hidden" name="id" value={unit.id} />}

      <section>
        <h2 className="text-sm font-medium">Identidad</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">Nombre</span>
            <input name="name" required defaultValue={unit?.name} className={field} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink/60">
              Dirección web <span className="text-ink/40">(opcional)</span>
            </span>
            <input
              name="slug"
              defaultValue={unit?.slug}
              placeholder="se genera del nombre"
              className={`${field} font-mono text-xs`}
            />
            <span className="mt-1 block text-xs text-ink/45">
              /alojamientos/<strong>{unit?.slug ?? '…'}</strong>
              {unit && ' — cambiarla rompe los enlaces ya compartidos'}
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm text-ink/60">Descripción</span>
            <textarea
              name="description"
              rows={4}
              defaultValue={unit?.description ?? ''}
              className={field}
            />
          </label>
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-sm font-medium">Capacidad</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Number name="maxGuests" label="Huéspedes" value={unit?.max_guests ?? 2} min={1} />
          <Number name="bedrooms" label="Habitaciones" value={unit?.bedrooms ?? 1} min={0} />
          <Number name="beds" label="Camas" value={unit?.beds ?? 1} min={0} />
          <Number
            name="bathrooms"
            label="Baños"
            value={unit?.bathrooms ?? 1}
            min={0}
            step={0.5}
          />
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-sm font-medium">Precio</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Number
            name="basePrice"
            label="Tarifa base por noche (USD)"
            value={unit?.base_price_usd ?? 0}
            min={0}
            step={0.01}
            hint="Las temporadas la sobreescriben en las fechas que cubran."
          />
          <Number
            name="cleaningFee"
            label="Limpieza (USD)"
            value={unit?.cleaning_fee_usd ?? 0}
            min={0}
            step={0.01}
            hint="Se cobra una vez por estadía."
          />
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-sm font-medium">Reglas de estadía</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Number
            name="minNights"
            label="Mínimo de noches"
            value={unit?.min_nights ?? 1}
            min={1}
          />
          <Number
            name="maxNights"
            label="Máximo de noches"
            value={unit?.max_nights ?? 0}
            min={0}
            hint="0 = sin límite"
          />
          <Number
            name="advanceNotice"
            label="Antelación mínima (días)"
            value={unit?.advance_notice_days ?? 0}
            min={0}
            hint="Como operador puedes saltártela."
          />
        </div>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Number
            name="sortOrder"
            label="Orden en el catálogo"
            value={unit?.sort_order ?? 0}
            min={0}
          />
          <label className="flex items-start gap-3 self-end pb-2 text-sm">
            <input
              name="isPublished"
              type="checkbox"
              defaultChecked={unit?.is_published ?? false}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Visible en el catálogo
              <span className="mt-0.5 block text-xs text-ink/45">
                Sin marcar no aparece en la web ni se puede reservar.
              </span>
            </span>
          </label>
        </div>
      </section>

      {state.error && (
        <p role="alert" className="rounded-xl bg-clay/15 px-4 py-3 text-sm text-ink/80">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-ink/10 pt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-ink px-6 py-2.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : unit ? 'Guardar cambios' : 'Crear unidad'}
        </button>
        {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
      </div>
    </form>
  )
}

function Number({
  name,
  label,
  value,
  min,
  step = 1,
  hint,
}: {
  name: string
  label: string
  value: number
  min: number
  step?: number
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink/60">{label}</span>
      <input
        name={name}
        type="number"
        min={min}
        step={step}
        defaultValue={value}
        className={field}
      />
      {hint && <span className="mt-1 block text-xs text-ink/45">{hint}</span>}
    </label>
  )
}
