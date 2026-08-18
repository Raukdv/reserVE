'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Navegación del panel.
 *
 * ## Dos grupos, no diez enlaces iguales
 *
 * Los diez pesaban lo mismo, y no se usan igual. Los cuatro primeros son el
 * trabajo del día —qué llega, qué se cobra, qué hay que verificar— y se abren
 * cada mañana. Los seis siguientes son configuración: se tocan al montar el
 * negocio y luego casi nunca.
 *
 * Mezclarlos obliga a leer la fila entera para encontrar «Pagos», que es a donde
 * se va varias veces al día.
 *
 * ## La página activa se marca
 *
 * El borde inferior ya estaba puesto en transparente, listo para esto, pero
 * ninguna página lo activaba: diez pestañas y ninguna señal de en cuál estás.
 *
 * `/admin` se compara exacto y el resto por prefijo. Si «Resumen» se comparara
 * por prefijo estaría activo en las diez, porque todas cuelgan de `/admin`.
 */
const DIARIO = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/calendario', label: 'Calendario' },
  { href: '/admin/reservas', label: 'Reservas' },
  { href: '/admin/pagos', label: 'Pagos' },
]

const AJUSTE = [
  { href: '/admin/unidades', label: 'Unidades' },
  { href: '/admin/tarifas', label: 'Tarifas' },
  { href: '/admin/cargos', label: 'Cargos' },
  { href: '/admin/amenidades', label: 'Amenidades' },
  { href: '/admin/contenido', label: 'Contenido' },
  { href: '/admin/ajustes', label: 'Ajustes' },
]

export function AdminNav({ pendingPayments = 0 }: { pendingPayments?: number }) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  const item = (entry: { href: string; label: string }, muted = false) => {
    const active = isActive(entry.href)
    const badge = entry.href === '/admin/pagos' ? pendingPayments : 0

    return (
      <li key={entry.href}>
        <Link
          href={entry.href}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-2 whitespace-nowrap border-b-2 py-3 transition ${
            active
              ? 'border-ink font-medium text-ink'
              : `border-transparent hover:border-ink/30 hover:text-ink ${
                  muted ? 'text-ink/60' : 'text-ink/70'
                }`
          }`}
        >
          {entry.label}

          {/*
            Lo que espera a ser verificado, ahí donde se va a buscarlo. Antes
            había que abrir Resumen para enterarse de que había dinero sin
            comprobar, y esa es la razón por la que se abre la app.
          */}
          {badge > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
              {badge}
            </span>
          )}
        </Link>
      </li>
    )
  }

  return (
    <nav className="mx-auto max-w-7xl overflow-x-auto px-6">
      <ul className="flex items-center gap-6 text-sm">
        {DIARIO.map((entry) => item(entry))}

        {/* Separa el trabajo del día de lo que se configura una vez. */}
        <li aria-hidden className="h-4 w-px shrink-0 bg-ink/15" />

        {AJUSTE.map((entry) => item(entry, true))}
      </ul>
    </nav>
  )
}
