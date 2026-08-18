import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRateSummary } from '@/lib/rates'
import { price } from '@/lib/format'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { SearchDates } from '@/components/search-dates'
import { UnitThumb } from '@/components/unit-thumb'
import { UnitsBook, type BookPage } from '@/components/units-book'
import { LocationMap } from '@/components/location-map'
import { unitCovers, siteImages } from '@/lib/media'
import { LayoutGrid, Plus } from 'lucide-react'
import { LinkButton } from '@/components/link-button'

export const revalidate = 300

type Section = Record<string, unknown> | undefined

const str = (s: Section, key: string, fallback = '') =>
  typeof s?.[key] === 'string' ? (s[key] as string) : fallback

const list = <T,>(s: Section, key: string): T[] =>
  Array.isArray(s?.[key]) ? (s[key] as T[]) : []

/** Coordenada del jsonb, o null si está vacía o no es un número usable. */
const num = (s: Section, key: string): number | null => {
  const value = Number(s?.[key])
  return Number.isFinite(value) && s?.[key] !== '' ? value : null
}

export default async function HomePage() {
  const supabase = await createClient()

  const [{ data: settings }, { data: units }, { data: content }, rates] =
    await Promise.all([
      supabase.from('app_settings').select('*').single(),
      supabase
        .from('units')
        .select('id, name, slug, description, max_guests, bedrooms, beds, base_price_usd, min_nights')
        .eq('is_published', true)
        .order('sort_order'),
      supabase.from('site_content').select('key, data'),
      getRateSummary(),
    ])

  const rate = rates.rate
  const display = settings?.currency_display ?? 'both'
  const businessName = settings?.business_name ?? 'reserVE'

  const s = Object.fromEntries(
    (content ?? []).map((c) => [c.key, c.data as Record<string, unknown>]),
  )

  const covers = await unitCovers((units ?? []).map((u) => u.id))
  const siteMedia = await siteImages(['hero', 'about', 'location'])

  /*
    Foto de la portada.

    Manda la que el operador suba para la sección; si no hay, se toma prestada la
    del primer alojamiento publicado. Ese préstamo es una red, no la norma: la
    cara del negocio no tiene por qué ser una habitación.
  */
  const hero =
    siteMedia.get('hero')?.[0] ?? (units?.[0] ? covers.get(units[0].id) : undefined)

  const about = siteMedia.get('about')?.[0]
  const mapLat = num(s.location, 'lat')
  const mapLng = num(s.location, 'lng')
  const location = siteMedia.get('location')?.[0]

  // Desde tres: con menos caben en un pliego y el libro sobra.
  const showBook = (units?.length ?? 0) >= 3

  const bookPages: BookPage[] = (units ?? []).map((unit) => ({
    id: unit.id,
    name: unit.name,
    slug: unit.slug,
    description: unit.description,
    meta:
      `${unit.max_guests} huéspedes · ${unit.bedrooms} hab. · ${unit.beds} camas` +
      (unit.min_nights > 1 ? ` · mín. ${unit.min_nights} noches` : ''),
    price: price(unit.base_price_usd, rate, display),
    coverUrl: covers.get(unit.id)?.url,
    coverAlt: covers.get(unit.id)?.alt ?? unit.name,
  }))

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-ink/10">
          <UnitThumb
            slug={businessName}
            src={hero?.url}
            alt={hero?.alt}
            priority
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-sand via-sand/80 to-sand/30" />

          <div className="relative mx-auto max-w-6xl px-6 pb-14 pt-24 sm:pt-32">
            {settings?.business_city && (
              <p className="text-xs uppercase tracking-[0.2em] text-ink/70">{settings.business_city}</p>
            )}
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              {str(s.hero, 'title', businessName)}
            </h1>
            <p className="mt-5 max-w-xl text-entrada text-ink/70">
              {str(s.hero, 'subtitle', 'Consulta disponibilidad y reserva tus fechas en línea.')}
            </p>

            <div className="mt-10 max-w-3xl">
              <SearchDates />
            </div>

            {rate && (
              <p className="mt-4 text-xs text-ink/60">
                Tarifas en USD. Referencia BCV: {rate.toLocaleString('es-VE')} Bs/USD
              </p>
            )}
          </div>
        </section>

        {/* Alojamientos */}
        <section id="alojamientos" className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Alojamientos</h2>
              <p className="mt-2 text-entrada text-ink/70">Elige el espacio que mejor se ajuste a tu estadía.</p>
            </div>
            <LinkButton href="/alojamientos" icon={LayoutGrid} className="shrink-0">
              Ver todos
            </LinkButton>
          </div>

          {units && units.length > 0 ? (
            <>
              {/*
                El catálogo como un cuaderno que se hojea: reservar es *to book*,
                y cada hoja es un alojamiento.

                Desde tres unidades. Con una o dos entran en el mismo pliego y el
                libro no aporta nada: quedan las flechas apagadas y un contador
                que dice «1 de 1». La rejilla las enseña mejor.

                Y solo aquí, en el escaparate. `/alojamientos` es el listado y se
                queda en rejilla, que es donde se compara.

                En móvil también rejilla: un pliego son dos páginas, y en 360 px
                cada una queda en 180 —ni para la foto—. Es CSS, sin JavaScript
                que lo sostenga.
              */}
              {showBook && (
                <div className="hidden sm:block">
                  <UnitsBook pages={bookPages} allHref="/alojamientos" />
                </div>
              )}

              <div className={`mt-10 grid gap-6 ${showBook ? 'sm:hidden' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
              {units.map((unit) => (
                <Link
                  key={unit.id}
                  href={`/alojamientos/${unit.slug}`}
                  className="group overflow-hidden rounded-2xl border border-ink/10 bg-white transition hover:border-ink/25 hover:shadow-sm"
                >
                  <UnitThumb
                    slug={unit.slug}
                    src={covers.get(unit.id)?.url}
                    alt={covers.get(unit.id)?.alt ?? unit.name}
                    className="aspect-[4/3] w-full"
                  />
                  <div className="p-5">
                    <h3 className="font-medium">{unit.name}</h3>
                    <p className="mt-2 line-clamp-2 text-sm text-ink/70">{unit.description}</p>
                    <p className="mt-4 text-xs text-ink/70">
                      {unit.max_guests} huéspedes · {unit.bedrooms} hab. · {unit.beds} camas
                      {unit.min_nights > 1 && ` · mín. ${unit.min_nights} noches`}
                    </p>
                    <p className="mt-3 text-sm font-medium">
                      {price(unit.base_price_usd, rate, display)}
                      <span className="font-normal text-ink/70"> / noche</span>
                    </p>
                  </div>
                </Link>
              ))}
              </div>
            </>
          ) : (
            <div className="mt-10 rounded-2xl border border-dashed border-ink/20 p-12 text-center">
              <p className="text-sm text-ink/70">Todavía no hay alojamientos publicados.</p>
              <LinkButton href="/admin/unidades" icon={Plus} tone="principal" className="mt-4">
                Crear el primero
              </LinkButton>
            </div>
          )}
        </section>

        {/* Sobre el negocio */}
        <section id="sobre" className="border-y border-ink/10 bg-white/50">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.2fr]">
            <UnitThumb
              slug="about-section"
              src={about?.url}
              alt={about?.alt}
              className="min-h-64 rounded-2xl"
            />
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                {str(s.about, 'title', 'Sobre nosotros')}
              </h2>
              <p className="mt-5 whitespace-pre-line text-entrada text-ink/70">
                {str(s.about, 'body', 'Sección editable desde el panel de administración.')}
              </p>
            </div>
          </div>
        </section>

        {/* Servicios */}
        <section id="servicios" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">
            {str(s.services, 'title', 'Servicios')}
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {list<{ label: string; detail: string }>(s.services, 'items').map((item) => (
              <div key={item.label} className="border-t border-ink/15 pt-4">
                <p className="font-medium">{item.label}</p>
                <p className="mt-1 text-descripcion text-ink/70">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Ubicación */}
        <section id="ubicacion" className="border-y border-ink/10 bg-white/50">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                {str(s.location, 'title', 'Cómo llegar')}
              </h2>
              <p className="mt-5 text-entrada text-ink/70">{str(s.location, 'body')}</p>
              <p className="mt-6 text-descripcion text-ink/70">
                {str(s.location, 'address', settings?.business_address ?? '')}
              </p>
            </div>
            {/*
              El mapa manda sobre la foto: responde la pregunta de la sección.
              Sin coordenadas cae a la foto, y sin foto al marcador de siempre.
            */}
            {mapLat !== null && mapLng !== null ? (
              <LocationMap
                lat={mapLat}
                lng={mapLng}
                label={str(s.location, 'address', settings?.business_address ?? '')}
              />
            ) : (
              <UnitThumb
                slug="mapa-ubicacion"
                src={location?.url}
                alt={location?.alt}
                className="min-h-64 rounded-2xl"
                label={location ? undefined : 'Sin foto todavía'}
              />
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">
            {str(s.faq, 'title', 'Preguntas frecuentes')}
          </h2>
          <div className="mt-8 divide-y divide-ink/10 border-y border-ink/10">
            {list<{ q: string; a: string }>(s.faq, 'items').map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-medium">
                  {item.q}
                  <span className="text-ink/60 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-ink/70">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Contacto */}
        <section id="contacto" className="mx-auto max-w-6xl px-6 pb-8">
          <div className="rounded-3xl border border-ink/10 bg-white p-10 sm:p-14">
            <h2 className="text-3xl font-semibold tracking-tight">
              {str(s.contact, 'title', 'Contacto')}
            </h2>
            <p className="mt-4 max-w-lg text-ink/70">{str(s.contact, 'body')}</p>

            <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm">
              {settings?.business_email && (
                <a href={`mailto:${settings.business_email}`} className="hover:underline">
                  {settings.business_email}
                </a>
              )}
              {settings?.business_phone && (
                <a
                  href={`https://wa.me/${settings.business_phone.replace(/\D/g, '')}`}
                  className="hover:underline"
                >
                  {settings.business_phone}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter
        businessName={businessName}
        email={settings?.business_email}
        phone={settings?.business_phone}
      />
    </>
  )
}
