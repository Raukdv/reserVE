import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usd, ves, dateLabel } from '@/lib/format'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { SearchDates } from '@/components/search-dates'
import { UnitThumb } from '@/components/unit-thumb'
import { unitPhotos } from '@/lib/media'
import { AvailabilityCalendar } from '@/components/availability-calendar'
import { genericPolicy, parseTiers } from '@/lib/cancellation'
import { AmenityIcon } from '@/components/amenity-icon'
import type { Quote } from '@/types/database'

export const dynamic = 'force-dynamic'

const ISO = /^\d{4}-\d{2}-\d{2}$/

const REASONS: Record<string, string> = {
  unavailable: 'Esas fechas ya están ocupadas.',
  too_many_guests: 'Supera la capacidad de esta unidad.',
  below_min_nights: 'La estadía es más corta que el mínimo.',
  above_max_nights: 'La estadía supera el máximo permitido.',
  too_soon: 'Necesita más antelación.',
  invalid_dates: 'Revisa las fechas.',
  no_exchange_rate: 'No hay tasa de cambio cargada.',
  stale_rate: 'La tasa oficial no está actualizada. Escríbenos y cerramos la reserva a mano.',
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('units').select('name').eq('slug', slug).maybeSingle()
  return { title: data?.name ?? 'Alojamiento' }
}

export default async function UnitPage({
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
  const searching = Boolean(from && to && to > from)

  const supabase = await createClient()

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()

  if (!unit) notFound()

  const [{ data: settings }, { data: amenities }, { data: holds }, { data: seasons }] =
    await Promise.all([
      supabase
        .from('app_settings')
        .select('business_name, business_email, business_phone, cancellation_policy, cancellation_tiers')
        .single(),
      supabase
        .from('unit_amenities')
        .select('amenities(slug, label, icon)')
        .eq('unit_id', unit.id),
      supabase
        .from('unit_holds')
        .select('stay')
        .eq('unit_id', unit.id)
        .eq('is_active', true),
      supabase
        .from('season_rates')
        .select('name, period, price_usd, min_nights')
        .eq('unit_id', unit.id)
        .order('period'),
    ])

  const photos = await unitPhotos(unit.id)

  let quote: Quote | null = null
  if (searching) {
    const { data } = await supabase.rpc('quote_stay', {
      p_unit_id: unit.id,
      p_check_in: from!,
      p_check_out: to!,
      p_guests: guests,
    })
    quote = (data as Quote) ?? null
  }

  const businessName = settings?.business_name ?? 'reserVE'
  const policyLines = genericPolicy(parseTiers(settings?.cancellation_tiers))
  const amenityList = (amenities ?? [])
    .map((a) => a.amenities)
    .filter((a): a is { slug: string; label: string; icon: string | null } => Boolean(a))

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link href="/alojamientos" className="text-sm text-ink/70 hover:underline">
          ← Alojamientos
        </Link>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{unit.name}</h1>
        <p className="mt-2 text-descripcion text-ink/70">
          {unit.max_guests} huéspedes · {unit.bedrooms} habitaciones · {unit.beds} camas ·{' '}
          {unit.bathrooms} baños
        </p>

        {/*
          Galería: portada grande y hasta cuatro secundarias.
          Cuando solo hay una foto ocupa el ancho entero en lugar de dejar
          cuatro huecos de degradado al lado, que se leerían como fotos que
          faltan por cargar y no como el catálogo de un alojamiento pequeño.
        */}
        <div
          className={`mt-8 grid gap-3 ${
            photos.length > 1 ? 'sm:grid-cols-4 sm:grid-rows-2' : ''
          }`}
        >
          <UnitThumb
            slug={unit.slug}
            src={photos[0]?.url}
            alt={photos[0]?.alt ?? unit.name}
            priority
            label={photos.length === 0 ? 'Sin fotos' : undefined}
            className={`rounded-2xl ${
              photos.length > 1
                ? 'sm:col-span-2 sm:row-span-2 sm:min-h-80'
                : 'min-h-64 sm:min-h-96'
            }`}
          />
          {photos.slice(1).map((photo, i) => (
            <UnitThumb
              key={photo.url}
              slug={`${unit.slug}-${i + 2}`}
              src={photo.url}
              alt={photo.alt ?? unit.name}
              className="min-h-32 rounded-2xl"
            />
          ))}
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_380px]">
          <div>
            <p className="whitespace-pre-line text-entrada text-ink/80">{unit.description}</p>

            {amenityList.length > 0 && (
              <>
                <h2 className="mt-12 text-xl font-semibold tracking-tight">Qué incluye</h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {amenityList.map((a) => (
                    <li key={a.slug} className="flex items-center gap-3 text-sm text-ink/70">
                      <AmenityIcon name={a.icon} className="h-4 w-4 text-ink/60" />
                      {a.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="mt-12 text-xl font-semibold tracking-tight">Disponibilidad</h2>
            <p className="mt-2 text-descripcion text-ink/70">
              Los días tachados están ocupados. El día de salida queda libre para el siguiente
              huésped.
            </p>
            <div className="mt-6">
              <AvailabilityCalendar ranges={(holds ?? []).map((h) => h.stay)} />
            </div>

            {seasons && seasons.length > 0 && (
              <>
                <h2 className="mt-12 text-xl font-semibold tracking-tight">Temporadas</h2>
                <table className="mt-5 w-full text-sm">
                  <tbody className="divide-y divide-ink/10">
                    {seasons.map((s) => {
                      const [start, end] = s.period.slice(1, -1).split(',')
                      return (
                        <tr key={s.name}>
                          <td className="py-3 pr-4">{s.name}</td>
                          <td className="py-3 pr-4 text-ink/70">
                            {dateLabel(start)} — {dateLabel(end)}
                          </td>
                          <td className="py-3 text-right font-medium">
                            {usd(s.price_usd)}
                            {s.min_nights && (
                              <span className="ml-2 font-normal text-ink/60">
                                mín. {s.min_nights}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}

            {(policyLines.length > 0 || settings?.cancellation_policy) && (
              <>
                <h2 className="mt-12 text-xl font-semibold tracking-tight">Cancelación</h2>
                {/*
                  Sin fechas concretas: aquí todavía no hay reserva. Los plazos
                  exactos aparecen en la página de la reserva, ya calculados.
                */}
                <ul className="mt-3 space-y-1.5">
                  {policyLines.map((line) => (
                    <li key={line} className="flex gap-3 text-sm text-ink/70">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-clay" />
                      {line}
                    </li>
                  ))}
                </ul>
                {settings?.cancellation_policy && (
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">
                    {settings.cancellation_policy}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Cotizador */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
              <p className="text-2xl font-semibold">
                {usd(unit.base_price_usd)}
                <span className="text-base font-normal text-ink/70"> / noche</span>
              </p>
              {unit.min_nights > 1 && (
                <p className="mt-1 text-xs text-ink/70">Mínimo {unit.min_nights} noches</p>
              )}

              {/*
                Apunta a esta misma ficha, no al listado: quien ya eligió
                alojamiento solo quiere ver el precio de sus fechas, no volver a
                buscar entre todas las unidades.
              */}
              <div className="mt-5">
                <SearchDates
                  defaults={{ from, to, guests }}
                  compact
                  target={`/alojamientos/${unit.slug}`}
                  submitLabel="Ver precio"
                />
              </div>

              {quote?.ok && (
                <div className="mt-6 space-y-2 border-t border-ink/10 pt-5 text-sm">
                  <Line
                    label={`${usd(unit.base_price_usd)} × ${quote.nights} noches`}
                    value={usd(quote.subtotal_usd)}
                  />
                  {/* Un renglón por cargo: el huésped ve qué está pagando. */}
                  {quote.fees?.map((fee) => (
                    <Line
                      key={fee.name}
                      label={
                        fee.kind === 'percent' ? `${fee.name} (${fee.rate} %)` : fee.name
                      }
                      value={usd(fee.amount_usd)}
                    />
                  ))}
                  <div className="flex justify-between border-t border-ink/10 pt-3 font-medium">
                    <span>Total</span>
                    <span>{usd(quote.total_usd)}</span>
                  </div>
                  <p className="text-right text-xs text-ink/70">{ves(quote.total_ves)}</p>

                  {/*
                    El monto en bolívares vale mientras rija esa tasa BCV. La
                    factura debe llevar la tasa de la fecha de la transacción, así
                    que al cambiar la fecha valor se recotiza.
                  */}
                  <p className="text-right text-[11px] text-ink/60">
                    A tasa BCV del {dateLabel(quote.rate_date)} · el monto en Bs se
                    recalcula si cambia
                  </p>

                  <div className="mt-4 rounded-xl bg-sand p-4 text-xs text-ink/70">
                    Para confirmar se paga un anticipo del{' '}
                    {Math.round(quote.deposit_ratio * 100)}%:{' '}
                    <strong className="font-medium text-ink">{usd(quote.deposit_usd)}</strong>.
                    El resto se cancela al llegar.
                  </div>

                  <Link
                    href={`/reservar/${unit.slug}?desde=${from}&hasta=${to}&huespedes=${guests}`}
                    className="mt-4 block rounded-xl bg-ink px-4 py-3 text-center text-sm text-sand transition hover:bg-ink/85"
                  >
                    Reservar
                  </Link>
                </div>
              )}

              {quote && !quote.ok && (
                <p className="mt-5 rounded-xl bg-clay/10 p-4 text-sm text-ink/70">
                  {REASONS[quote.error] ?? 'No disponible en esas fechas.'}
                  {quote.min_nights ? ` Mínimo ${quote.min_nights} noches.` : ''}
                </p>
              )}

              {!searching && (
                <p className="mt-5 text-xs text-ink/70">
                  Elige tus fechas para ver el total y el anticipo.
                </p>
              )}
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
    <div className="flex justify-between text-ink/70">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
