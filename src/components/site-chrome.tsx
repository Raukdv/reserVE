import Link from 'next/link'

export function SiteHeader({ businessName }: { businessName: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-sand/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          {businessName}
        </Link>

        <div className="flex items-center gap-6 text-sm">
          <Link href="/alojamientos" className="hidden hover:underline sm:inline">
            Alojamientos
          </Link>
          <Link href="/#servicios" className="hidden hover:underline sm:inline">
            Servicios
          </Link>
          <Link href="/#contacto" className="hidden hover:underline sm:inline">
            Contacto
          </Link>
          <Link
            href="/alojamientos"
            className="rounded-full bg-ink px-4 py-2 text-sand transition hover:bg-ink/85"
          >
            Reservar
          </Link>
        </div>
      </nav>
    </header>
  )
}

export function SiteFooter({
  businessName,
  email,
  phone,
}: {
  businessName: string
  email?: string | null
  phone?: string | null
}) {
  return (
    <footer className="mt-24 border-t border-ink/10">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3">
        <div>
          <p className="font-semibold">{businessName}</p>
          {email && <p className="mt-2 text-sm text-ink/60">{email}</p>}
          {phone && <p className="text-sm text-ink/60">{phone}</p>}
        </div>

        <div className="text-sm">
          <p className="font-medium">Reservas</p>
          <ul className="mt-2 space-y-1 text-ink/60">
            <li><Link href="/alojamientos" className="hover:underline">Ver disponibilidad</Link></li>
            <li><Link href="/#faq" className="hover:underline">Preguntas frecuentes</Link></li>
          </ul>
        </div>

        <div className="text-sm">
          <p className="font-medium">Legal</p>
          <ul className="mt-2 space-y-1 text-ink/60">
            <li><Link href="/legal/condiciones" className="hover:underline">Condiciones</Link></li>
            <li><Link href="/legal/cancelacion" className="hover:underline">Cancelación</Link></li>
            <li><Link href="/login" className="hover:underline">Acceso interno</Link></li>
          </ul>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-10 text-xs text-ink/40">
        © {new Date().getFullYear()} {businessName}
      </div>
    </footer>
  )
}
