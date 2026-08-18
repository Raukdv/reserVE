'use client'

import { Suspense, useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { LinkButton } from '@/components/link-button'
import { login, type LoginState } from './actions'

/*
  Esta página se quedó fuera de todos los pases de diseño porque usaba `black`
  en vez de `ink`, y los barridos buscaban `ink`. Arrastraba además un botón
  invisible: `bg-[--color-ink]` no es sintaxis válida en Tailwind v4 —haría falta
  `bg-[var(--color-ink)]`, o `bg-ink` a secas porque el token está en `@theme`—
  así que no generaba fondo y quedaba texto blanco sobre arena.
*/

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

function LoginForm() {
  const next = useSearchParams().get('next') ?? '/admin'
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {})

  return (
    <form action={formAction} className="w-full max-w-sm">
      <div className="rounded-2xl border border-ink/10 bg-white p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Acceder</h1>
        <p className="mt-1 text-descripcion text-ink/70">
          Panel de administración. Solo para el equipo.
        </p>

        <input type="hidden" name="next" value={next} />

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Correo</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Contraseña</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={field}
            />
          </label>
        </div>

        {state.error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay/15 px-4 py-3 text-sm text-ink/80">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-xl bg-ink px-6 py-2.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </div>

      <p className="mt-4 text-center">
        <LinkButton href="/" icon={ArrowLeft}>
          Volver al sitio
        </LinkButton>
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
