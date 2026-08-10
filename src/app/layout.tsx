import type { Metadata } from 'next'
import { publicEnv } from '@/lib/env'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'reserVE — Reservas',
    template: '%s · reserVE',
  },
  description: 'Sistema de reservas por fechas.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
