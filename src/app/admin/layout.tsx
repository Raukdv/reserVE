import Link from 'next/link'
import { getProfile } from '@/lib/supabase/server'
import { logout } from '../login/actions'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/calendario', label: 'Calendario' },
  { href: '/admin/reservas', label: 'Reservas' },
  { href: '/admin/pagos', label: 'Pagos' },
  { href: '/admin/unidades', label: 'Unidades' },
  { href: '/admin/tarifas', label: 'Tarifas' },
  { href: '/admin/contenido', label: 'Contenido' },
  { href: '/admin/ajustes', label: 'Ajustes' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // El middleware ya bloqueó el acceso sin rol staff; aquí solo se muestra quién
  // está dentro.
  const profile = await getProfile()

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              reserVE
            </Link>
            <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] uppercase tracking-wider text-ink/55">
              Admin
            </span>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-ink/50 sm:inline">{profile?.full_name}</span>
            <form action={logout}>
              <button className="text-ink/50 hover:underline">Salir</button>
            </form>
          </div>
        </div>

        <nav className="mx-auto max-w-7xl overflow-x-auto px-6">
          <ul className="flex gap-6 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap border-b-2 border-transparent py-3 text-ink/65 transition hover:border-ink/30 hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {children}
    </div>
  )
}
