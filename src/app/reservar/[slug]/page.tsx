import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usd, ves, dateLabel } from '@/lib/format'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { UnitThumb } from '@/components/unit-thumb'
import { BookingForm } from './booking-form'
import type { Quote } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reservar' }

const ISO = /^\d{4}-\d{2}-\d{2}$/

const REASONS: Record<string, string> = {
  unavailable: 'Esas fechas ya están ocupadas.',
  too_many_guests: 'Supera la capacidad de esta unidad.',
  below_min_nights: 'La estadía es más corta que el mínimo.',
  above_max_nights: 'La estadía supera el máximo permitido.',
  too_soon: 'Necesita más antelación.',
  invalid_dates: 'Revisa las fechas.',
  stale_rate: 'La tasa oficial no está actualizada. Escríbenos y cerramos la reserva a mano.',
  no_exchange_rate: 'No hay tasa de cambio cargada.',
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k])

  const from = ISO.test(one('desde') ?? '') ? one('desde')! : undefined
  const to = ISO.test(one('hasta') ?? '') ? one('hasta')! : undefined
  const guests = Number(one('huespedes')) || 2

  const supabase = await createClient()

  const { data: unit } = await supabase
    .from('units')
    .select('id, name, slug, description, max_guests, bedrooms, beds, base_price_usd')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()

  if (!unit) notFound()

  const { data: settings } = await supabase
    .from('app_settings')
    .select('business_name, business_email, business_phone, cancellation_policy')
    .single()

  const businessName = settings?.business_name ?? 'reserVE'

  // Sin fechas no hay nada que reservar: se devuelve al detalle en vez de mostrar
  // un formulario que fallaría al enviarse.
  if (!from || !to || to <= from) {
    return (
      <>
        <SiteHeader businessName={businessName} />
        <main className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Elige tus fechas</h1>
          <p className="mt-3 text-ink/60">
            Necesitamos la entrada y la salida para calcular el total.
          </p>
          <Link
            href={`/alojamientos/${slug}`}
            className="mt-8 inline-block rounded-xl bg-ink px-6 py-3 text-sm text-sand"
          >
            Volver a {unit.name}
          </Link>
        </main>
        <SiteFooter businessName={businessName} />
      </>
    )
  }

  const { data } = await supabase.rpc('quote_stay', {
    p_unit_id: unit.id,
    p_check_in: from,
    p_check_out: to,
    p_guests: guests,
  })
  const quote = data as Quote | null

  if (!quote?.ok) {
    return (
      <>
        <SiteHeader businessName={businessName} />
        <main className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">No podemos reservar eso</h1>
          <p className="mt-3 text-ink/60">
            {REASONS[quote?.error ?? ''] ?? 'Esa combinación no está disponible.'}
          </p>
          <Link
            href={`/alojamientos/${slug}`}
            className="mt-8 inline-block rounded-xl bg-ink px-6 py-3 text-sm text-sand"
          >
            Probar otras fechas
          </Link>
        </main>
        <SiteFooter businessName={businessName} />
      </>
    )
  }

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link href={`/alojamientos/${slug}`} className="text-sm text-ink/50 hover:underline">
          ← {unit.name}
        </Link>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Confirma tus datos</h1>

        <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
          <BookingForm
            unitId={unit.id}
            checkIn={from}
            checkOut={to}
            guests={guests}
          />

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
              <UnitThumb slug={unit.slug} className="aspect-[16/9] w-full" />

              <div className="space-y-4 p-6">
                <div>
                  <p className="font-medium">{unit.name}</p>
                  <p className="mt-1 text-sm text-ink/55">
                    {dateLabel(from)} → {dateLabel(to)}
                  </p>
                  <p className="text-sm text-ink/55">
                    {quote.nights} noche{quote.nights > 1 ? 's' : ''} · {guests} huésped
                    {guests > 1 ? 'es' : ''}
                  </p>
                </div>

                <dl className="space-y-2 border-t border-ink/10 pt-4 text-sm">
                  <Line
                    label={`${usd(unit.base_price_usd)} × ${quote.nights} noches`}
                    value={usd(quote.subtotal_usd)}
                  />
                  {quote.cleaning_fee_usd > 0 && (
                    <Line label="Limpieza" value={usd(quote.cleaning_fee_usd)} />
                  )}
                  <div className="flex justify-between border-t border-ink/10 pt-3 font-medium">
                    <dt>Total</dt>
                    <dd>{usd(quote.total_usd)}</dd>
                  </div>
                  <p className="text-right text-xs text-ink/50">{ves(quote.total_ves)}</p>
                  <p className="text-right text-[11px] text-ink/40">
                    A tasa BCV del {dateLabel(quote.rate_date)}
                  </p>
                </dl>

                <div className="rounded-xl bg-sand p-4 text-xs leading-relaxed text-ink/70">
                  Para confirmar se paga un anticipo del{' '}
                  {Math.round(quote.deposit_ratio * 100)}%:{' '}
                  <strong className="font-medium text-ink">{usd(quote.deposit_usd)}</strong>.
                  El resto se cancela al llegar.
                </div>

                {settings?.cancellation_policy && (
                  <p className="text-xs leading-relaxed text-ink/50">
                    {settings.cancellation_policy}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter
        businessName={businessName}
        email={settings?.business_email}
        phone={settings?.business_phone}
      />
    </>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink/65">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
