import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { createClient, getProfile } from '@/lib/supabase/server'
import { AdminNav } from '@/components/admin-nav'
import { logout } from '../login/actions'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // El middleware ya bloqueó el acceso sin rol staff; aquí solo se muestra quién
  // está dentro.
  const profile = await getProfile()

  /*
    Los pagos por verificar se cuentan aquí y no en cada página porque la señal
    va en la navegación, que es común a todas. Es un `count` con `head`, sin
    traer filas: una consulta indexada por visita al panel.
  */
  const supabase = await createClient()
  const { count: pendingPayments } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'verifying')

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              reserVE
            </Link>
            <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] uppercase tracking-wider text-ink/70">
              Admin
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink/70 sm:inline">{profile?.full_name}</span>

            {/*
              Salir era texto suelto pegado al nombre. Con forma de control se
              separa de la etiqueta que tiene al lado y gana un objetivo
              pulsable de verdad, que a 14 px de alto no llegaba al mínimo.
            */}
            <form action={logout}>
              <button className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-3 py-1.5 text-sm text-ink/70 transition hover:border-ink/40 hover:text-ink">
                <LogOut className="h-4 w-4" aria-hidden />
                Salir
              </button>
            </form>
          </div>
        </div>

        <AdminNav pendingPayments={pendingPayments ?? 0} />
      </header>

      {children}
    </div>
  )
}
