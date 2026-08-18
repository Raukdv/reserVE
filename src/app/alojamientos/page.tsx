import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRateSummary } from '@/lib/rates'
import { price, usd, dateLabel } from '@/lib/format'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { SearchDates } from '@/components/search-dates'
import { UnitThumb } from '@/components/unit-thumb'
import { unitCovers } from '@/lib/media'
import type { Quote } from '@/types/database'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Alojamientos' }

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Mensajes de quote_stay(). El servidor decide; aquí solo se traducen.
const REASONS: Record<string, string> = {
  unavailable: 'Ocupado en esas fechas',
  too_many_guests: 'Excede la capacidad',
  below_min_nights: 'Estadía demasiado corta',
  above_max_nights: 'Estadía demasiado larga',
  too_soon: 'Requiere más antelación',
  invalid_dates: 'Fechas inválidas',
  no_exchange_rate: 'Tasa no disponible',
  stale_rate: 'Tasa desactualizada',
  unit_not_found: 'No disponible',
}

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k])

  const from = ISO.test(one('desde') ?? '') ? one('desde')! : undefined
  const to = ISO.test(one('hasta') ?? '') ? one('hasta')! : undefined
  const guests = Number(one('huespedes')) || 2
  const searching = Boolean(from && to && to > from)

  const supabase = await createClient()

  const [{ data: settings }, { data: units }, rates] = await Promise.all([
    supabase.from('app_settings').select('business_name, business_email, business_phone, currency_display').single(),
    supabase
      .from('units')
      .select('id, name, slug, description, max_guests, bedrooms, beds, bathrooms, base_price_usd, min_nights')
      .eq('is_published', true)
      .order('sort_order'),
    getRateSummary(),
  ])

  const rate = rates.rate
  const display = settings?.currency_display ?? 'both'
  const businessName = settings?.business_name ?? 'reserVE'

  const covers = await unitCovers((units ?? []).map((u) => u.id))

  // Una cotización por unidad. El precio y la disponibilidad los resuelve
  // Postgres: el navegador nunca calcula totales.
  const quotes = new Map<string, Quote>()
  if (searching && units) {
    const results = await Promise.all(
      units.map((u) =>
        supabase.rpc('quote_stay', {
          p_unit_id: u.id,
          p_check_in: from!,
          p_check_out: to!,
          p_guests: guests,
        }),
      ),
    )
    results.forEach((r, i) => {
      if (r.data) quotes.set(units[i].id, r.data as Quote)
    })
  }

  const available = units?.filter((u) => !searching || quotes.get(u.id)?.ok) ?? []
  const unavailable = units?.filter((u) => searching && !quotes.get(u.id)?.ok) ?? []

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Alojamientos</h1>

        <div className="mt-6">
          <SearchDates defaults={{ from, to, guests }} compact />
        </div>

        {searching && (
          <p className="mt-5 text-descripcion text-ink/70">
            {dateLabel(from!)} → {dateLabel(to!)} · {guests} huésped{guests > 1 ? 'es' : ''} ·{' '}
            <strong className="font-medium text-ink">{available.length}</strong> disponible
            {available.length === 1 ? '' : 's'}
          </p>
        )}

        {available.length > 0 ? (
          <div className="mt-8 space-y-5">
            {available.map((unit) => {
              const quote = quotes.get(unit.id)
              const href = searching
                ? `/alojamientos/${unit.slug}?desde=${from}&hasta=${to}&huespedes=${guests}`
                : `/alojamientos/${unit.slug}`

              return (
                <Link
                  key={unit.id}
                  href={href}
                  className="group grid overflow-hidden rounded-2xl border border-ink/10 bg-white transition hover:border-ink/25 hover:shadow-sm sm:grid-cols-[240px_1fr]"
                >
                  <UnitThumb
                    slug={unit.slug}
                    src={covers.get(unit.id)?.url}
                    alt={covers.get(unit.id)?.alt ?? unit.name}
                    className="min-h-44"
                  />

                  <div className="flex flex-col justify-between gap-4 p-6 sm:flex-row">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">{unit.name}</h2>
                      <p className="mt-2 max-w-xl text-sm text-ink/70">{unit.description}</p>
                      <p className="mt-4 text-xs text-ink/70">
                        {unit.max_guests} huéspedes · {unit.bedrooms} hab. · {unit.beds} camas ·{' '}
                        {unit.bathrooms} baños
                      </p>
                    </div>

                    <div className="shrink-0 text-left sm:text-right">
                      {quote?.ok ? (
                        <>
                          <p className="text-lg font-medium">{usd(quote.total_usd)}</p>
                          <p className="text-xs text-ink/70">
                            {quote.nights} noche{quote.nights > 1 ? 's' : ''} · limpieza incluida
                          </p>
                          {rate && (
                            <p className="mt-1 text-xs text-ink/70">
                              {quote.total_ves.toLocaleString('es-VE', {
                                maximumFractionDigits: 2,
                              })}{' '}
                              Bs
                            </p>
                          )}
                          <p className="mt-3 text-xs text-ink/70">
                            Anticipo {Math.round(quote.deposit_ratio * 100)}%:{' '}
                            {usd(quote.deposit_usd)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-medium">
                            {price(unit.base_price_usd, rate, display)}
                          </p>
                          <p className="text-xs text-ink/70">por noche</p>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <p className="mt-8 rounded-2xl border border-dashed border-ink/20 p-12 text-center text-sm text-ink/70">
            {searching
              ? 'Ninguna unidad disponible en esas fechas. Prueba con otro rango.'
              : 'Todavía no hay alojamientos publicados.'}
          </p>
        )}

        {unavailable.length > 0 && (
          <>
            <h2 className="mt-14 text-base font-semibold">No disponible en esas fechas</h2>
            <div className="mt-4 space-y-3">
              {unavailable.map((unit) => {
                const quote = quotes.get(unit.id)
                const reason = quote && !quote.ok ? REASONS[quote.error] ?? 'No disponible' : ''
                return (
                  <div
                    key={unit.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-ink/10 px-5 py-4 text-sm opacity-60"
                  >
                    <span>{unit.name}</span>
                    <span className="text-xs text-ink/70">
                      {reason}
                      {quote && !quote.ok && quote.min_nights
                        ? ` (mín. ${quote.min_nights})`
                        : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>

      <SiteFooter
        businessName={businessName}
        email={settings?.business_email}
        phone={settings?.business_phone}
      />
    </>
  )
}
