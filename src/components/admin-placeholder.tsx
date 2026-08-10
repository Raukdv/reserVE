import Link from 'next/link'

/**
 * Sección del panel todavía sin construir.
 *
 * Existe porque el menú enlaza a todas las secciones desde el principio: sin una
 * página real, Next precarga esas rutas y el navegador acumula 404 en consola,
 * además de dejar al operador ante una pantalla de error sin explicación.
 *
 * Se borra en cuanto la sección se implemente.
 */
export function AdminPlaceholder({
  title,
  description,
  bullets,
  meanwhile,
}: {
  title: string
  description: string
  bullets: string[]
  meanwhile?: { label: string; href: string }
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-ink/60">{description}</p>

      <div className="mt-8 rounded-2xl border border-dashed border-ink/20 p-8">
        <p className="text-xs font-medium uppercase tracking-wider text-ink/45">
          Todavía sin construir
        </p>
        <ul className="mt-4 space-y-2 text-sm text-ink/70">
          {bullets.map((b) => (
            <li key={b} className="flex gap-3">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-clay" />
              {b}
            </li>
          ))}
        </ul>

        {meanwhile && (
          <p className="mt-6 text-sm text-ink/55">
            Mientras tanto:{' '}
            <Link href={meanwhile.href} className="underline">
              {meanwhile.label}
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
