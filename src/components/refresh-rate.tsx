'use client'

import { useActionState } from 'react'
import { RefreshCw } from 'lucide-react'
import { refreshRate, type RefreshState } from '@/app/admin/actions'

/**
 * Pide la tasa ahora, sin esperar al cron diario.
 *
 * Va junto a la cifra que actualiza. La respuesta se dice entera —si cambió, si
 * ya estaba al día, si una fuente falló— porque un botón que solo se apaga y se
 * enciende deja al operador sin saber si sirvió de algo.
 */
export function RefreshRate() {
  const [state, action, pending] = useActionState<RefreshState, FormData>(
    () => refreshRate(),
    {},
  )

  return (
    <div className="mt-3">
      <form action={action}>
        <button
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm transition hover:border-ink/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} aria-hidden />
          {pending ? 'Consultando…' : 'Actualizar tasa'}
        </button>
      </form>

      {state.ok && <p className="mt-2 text-sm text-moss">{state.ok}</p>}
      {state.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </div>
  )
}
