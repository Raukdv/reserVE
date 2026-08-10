'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteUnit, type UnitState } from '@/app/admin/unidades/actions'

/**
 * Borrado con confirmación por nombre.
 *
 * Escribir el nombre exacto no es fricción decorativa: la acción es
 * irreversible y se llega a ella desde la misma pantalla donde se editan
 * campos inocuos.
 */
export function DeleteUnitButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<UnitState, FormData>(deleteUnit, {})
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  if (state.ok) {
    router.push('/admin/unidades')
    return <p className="text-sm text-moss">{state.ok}</p>
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-ink/45 underline hover:text-red-700"
        >
          Eliminar unidad
        </button>
        {state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
      </>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink/70">
        Escribe <strong className="font-medium">{name}</strong> para confirmar.
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || typed !== name}
          className="rounded-lg bg-red-700 px-5 py-2 text-sm text-white disabled:opacity-40"
        >
          {pending ? 'Eliminando…' : 'Eliminar definitivamente'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-ink/50 underline"
        >
          Cancelar
        </button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  )
}
