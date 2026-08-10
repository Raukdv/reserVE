'use client'

import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { login, type LoginState } from './actions'

function LoginForm() {
  const next = useSearchParams().get('next') ?? '/admin'
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {})

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Acceder</h1>

      <input type="hidden" name="next" value={next} />

      <label className="block space-y-1">
        <span className="text-sm text-black/60">Correo</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-lg border border-black/15 bg-white px-3 py-2"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-black/60">Contraseña</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-black/15 bg-white px-3 py-2"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[--color-ink] px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
