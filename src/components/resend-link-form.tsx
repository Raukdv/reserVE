'use client'

import { useActionState } from 'react'
import { resendBookingLink, type SettingsState } from '@/app/admin/ajustes/actions'

/**
 * Reenvía a un huésped el enlace de su reserva.
 *
 * El código solo vive en la URL y en el correo, así que cuando alguien escribe
 * «no me llegó nada» esta es la salida: sin esto habría que entrar a la base de
 * datos a buscar el código y mandarlo a mano.
 */
export function ResendLinkForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    resendBookingLink,
    {},
  )

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input
        name="code"
        required
        placeholder="B529272E"
        className="w-40 rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-ink/40"
      />
      <button
        disabled={pending}
        className="rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40 disabled:opacity-50"
      >
        {pending ? 'Enviando…' : 'Reenviar enlace'}
      </button>
      {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
      {state.error && <span className="text-sm text-red-700">{state.error}</span>}
    </form>
  )
}
