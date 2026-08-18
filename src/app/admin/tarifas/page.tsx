import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { parseRange } from '@/lib/format'
import { SeasonRates, type UnitRates } from '@/components/season-rates'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tarifas' }

export default async function RatesPage() {
  const supabase = await createClient()

  const { data: units } = await supabase
    .from('units')
    .select(`
      id, name, base_price_usd, min_nights,
      season_rates ( id, name, period, price_usd, min_nights )
    `)
    .order('sort_order')

  const model: UnitRates[] = (units ?? []).map((unit) => ({
    id: unit.id,
    name: unit.name,
    basePriceUsd: Number(unit.base_price_usd),
    minNights: unit.min_nights,
    seasons: (unit.season_rates ?? [])
      .map((s) => {
        const { from, to } = parseRange(s.period)
        return {
          id: s.id,
          name: s.name,
          from,
          to,
          priceUsd: Number(s.price_usd),
          minNights: s.min_nights,
        }
      })
      .sort((a, b) => a.from.localeCompare(b.from)),
  }))

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Tarifas</h1>
      <p className="mt-2 text-descripcion text-ink/70">
        Cada unidad tiene una tarifa base y, opcionalmente, temporadas que la sobreescriben
        en las fechas que cubran. El precio de una estadía se calcula noche a noche.
      </p>

      {model.length > 0 ? (
        <div className="mt-8">
          <SeasonRates units={model} />
        </div>
      ) : (
        <p className="mt-8 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/70">
          No hay unidades todavía.{' '}
          <Link href="/admin/unidades/nueva" className="underline">
            Crear la primera
          </Link>
        </p>
      )}

      <p className="mt-8 text-xs text-ink/60">
        La tarifa base y el mínimo de noches de cada unidad se editan en{' '}
        <Link href="/admin/unidades" className="underline">
          Unidades
        </Link>
        .
      </p>
    </main>
  )
}
