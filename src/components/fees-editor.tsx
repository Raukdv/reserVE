'use client'

import { useActionState, useState } from 'react'
import { saveFee, deleteFee, type FeeState } from '@/app/admin/cargos/actions'
import { FEE_KINDS, feeRateLabel, type Fee, type FeeKind } from '@/lib/fees'

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

/**
 * Cargos de un alcance: generales (sin unidad) o de una unidad concreta.
 *
 * El mismo componente sirve para los dos porque la única diferencia es a qué
 * unidad se atan, y eso viaja en un campo oculto.
 */
export function FeesEditor({
  fees,
  unitId,
  emptyHint,
}: {
  fees: Fee[]
  /** Sin valor, los cargos son generales. */
  unitId?: string
  emptyHint: string
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div>
      {fees.length > 0 ? (
        <ul className="space-y-3">
          {fees.map((fee) => (
            <FeeRow key={fee.id} fee={fee} unitId={unitId} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-ink/20 p-8 text-center text-sm text-ink/70">
          {emptyHint}
        </p>
      )}

      {adding ? (
        <div className="mt-3 rounded-2xl border border-ink/15 bg-white p-4">
          <p className="mb-3 text-sm font-medium">Nuevo cargo</p>
          <FeeForm unitId={unitId} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40"
        >
          Añadir cargo
        </button>
      )}
    </div>
  )
}

function FeeRow({ fee, unitId }: { fee: Fee; unitId?: string }) {
  const [editing, setEditing] = useState(false)
  const [state, remove, removing] = useActionState<FeeState, FormData>(deleteFee, {})

  return (
    <li className="rounded-2xl border border-ink/10 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{fee.name}</span>
            <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/70">
              {feeRateLabel(fee.kind, fee.amount)}
            </span>
            {!fee.is_active && (
              <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/60">
                Desactivado
              </span>
            )}
            {fee.kind !== 'percent' && fee.refundable && (
              <span className="rounded-full bg-moss/15 px-2 py-0.5 text-[11px] text-moss">
                Reembolsable
              </span>
            )}
          </p>
          {fee.description && (
            <p className="mt-1 text-descripcion text-ink/70">{fee.description}</p>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          {state.error && <span className="text-xs text-red-700">{state.error}</span>}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-ink/70 underline hover:text-ink"
          >
            {editing ? 'Cerrar' : 'Editar'}
          </button>
          <form action={remove}>
            <input type="hidden" name="id" value={fee.id} />
            <button
              disabled={removing}
              className="text-ink/60 underline hover:text-red-700 disabled:opacity-50"
            >
              {removing ? 'Eliminando…' : 'Eliminar'}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-ink/10 p-4">
          <FeeForm fee={fee} unitId={unitId} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  )
}

function FeeForm({
  fee,
  unitId,
  onDone,
}: {
  fee?: Fee
  unitId?: string
  onDone: () => void
}) {
  const [state, action, pending] = useActionState<FeeState, FormData>(saveFee, {})
  const [kind, setKind] = useState<FeeKind>(fee?.kind ?? 'fixed')

  if (state.ok) queueMicrotask(onDone)

  const spec = FEE_KINDS.find((k) => k.value === kind)

  return (
    <form action={action} className="space-y-3">
      {fee && <input type="hidden" name="id" value={fee.id} />}
      <input type="hidden" name="unitId" value={unitId ?? ''} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Nombre</span>
          <input
            name="name"
            required
            defaultValue={fee?.name}
            placeholder="Limpieza"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Cómo se cobra</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FeeKind)}
            className={field}
          >
            {FEE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">
            {kind === 'percent' ? 'Porcentaje' : 'Monto (USD)'}
          </span>
          <div className="relative">
            <input
              name="amount"
              type="number"
              min={0}
              max={kind === 'percent' ? 100 : undefined}
              step="0.01"
              required
              defaultValue={fee?.amount ?? 0}
              className={`${field} ${kind === 'percent' ? 'pr-8' : ''}`}
            />
            {kind === 'percent' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">
                %
              </span>
            )}
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">Orden</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={99}
            defaultValue={fee?.sort_order ?? 0}
            className={field}
          />
        </label>

        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="mb-1 block text-xs font-medium text-ink">
            Explicación para el huésped <span className="text-ink/60">(opcional)</span>
          </span>
          <input
            name="description"
            defaultValue={fee?.description ?? ''}
            placeholder="Se cobra una vez por estadía."
            className={field}
          />
        </label>
      </div>

      {spec && <p className="text-xs text-ink/60">{spec.hint}</p>}

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={fee?.is_active ?? true}
            className="h-4 w-4"
          />
          Activo
        </label>

        {/*
          Un porcentaje sigue a su base: se devuelve en proporción a lo que se
          reembolse de ella, así que la bandera no le aplica.
        */}
        {kind !== 'percent' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              name="refundable"
              type="checkbox"
              defaultChecked={fee?.refundable ?? false}
              className="h-4 w-4"
            />
            Se devuelve en cancelaciones parciales
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
        >
          {pending ? 'Guardando…' : fee ? 'Guardar' : 'Añadir'}
        </button>
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  )
}
