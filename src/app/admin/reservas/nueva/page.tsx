import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRateSummary } from '@/lib/rates'
import { NewBookingForm } from './new-booking-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva reserva' }

export default async function NewBookingPage() {
  const supabase = await createClient()

  const [{ data: units }, rates] = await Promise.all([
    supabase
      .from('units')
      .select('id, name, max_guests, base_price_usd')
      .order('sort_order'),
    getRateSummary(),
  ])

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/reservas" className="text-sm text-ink/50 hover:underline">
        ← Reservas
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nueva reserva</h1>
      <p className="mt-2 text-sm text-ink/55">
        Para las que entran por teléfono, WhatsApp o en el mostrador, donde el huésped no
        usa la web.
      </p>

      {rates.stale && (
        <p className="mt-6 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-medium">Tasa desactualizada.</strong> No se puede
          cotizar en bolívares hasta que el alimentador vuelva a correr. Revisa el cron
          antes de crear reservas.
        </p>
      )}

      {units && units.length > 0 ? (
        <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
          <NewBookingForm units={units} />
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/50">
          No hay unidades creadas todavía.
        </p>
      )}
    </main>
  )
}
