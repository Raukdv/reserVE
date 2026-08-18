import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'
import { POLICY_TITLE, genericPolicy, parseTiers } from '@/lib/cancellation'
import { ArrowLeft } from 'lucide-react'
import { LinkButton } from '@/components/link-button'

export const revalidate = 300

/**
 * Páginas legales.
 *
 * El texto vive en la base y no en el código: es vinculante y lo redacta el
 * negocio, no quien programa. Cambiarlo no debería requerir un despliegue.
 *
 * Cancelación es la excepción, y por eso su `key` es nula: su cuerpo no se
 * redacta a mano. Lo genera `genericPolicy()` desde los mismos tramos que usa
 * `cancellation_quote()` para devolver el dinero, así que lo que el huésped lee
 * y lo que el servidor le paga salen del único sitio donde eso se decide. Lo
 * editable —título y texto de apoyo— vive en `app_settings`, junto a los tramos.
 */
const PAGES = {
  condiciones: { key: 'legal_condiciones', fallbackTitle: 'Condiciones de reserva' },
  cancelacion: { key: null, fallbackTitle: POLICY_TITLE },
  privacidad: { key: 'legal_privacidad', fallbackTitle: 'Privacidad' },
} as const

type Slug = keyof typeof PAGES

export function generateStaticParams() {
  return Object.keys(PAGES).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = PAGES[slug as Slug]
  return { title: page?.fallbackTitle ?? 'Legal' }
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = PAGES[slug as Slug]
  if (!page) notFound()

  const supabase = await createClient()

  const [{ data: settings }, { data: row }] = await Promise.all([
    supabase
      .from('app_settings')
      .select('business_name, business_email, business_phone, cancellation_title, cancellation_policy, cancellation_tiers, check_in_time, check_out_time')
      .single(),
    page.key
      ? supabase.from('site_content').select('data').eq('key', page.key).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const isPolicy = page.key === null
  const content = (row?.data ?? {}) as { title?: string; body?: string }
  const businessName = settings?.business_name ?? 'reserVE'

  const title =
    (isPolicy ? settings?.cancellation_title : content.title)?.trim() || page.fallbackTitle

  // El texto de apoyo de la política vive en ajustes; el de las demás páginas,
  // en el contenido editable. En ambos casos son párrafos separados por una
  // línea en blanco.
  const body = (isPolicy ? settings?.cancellation_policy : content.body)?.trim() ?? ''
  const paragraphs = body ? body.split(/\n{2,}/).filter(Boolean) : []

  // Los plazos configurados se muestran siempre: son la política que el huésped
  // acepta al reservar, esté o no redactado el texto de apoyo.
  const policyLines = isPolicy ? genericPolicy(parseTiers(settings?.cancellation_tiers)) : []
  const hasContent = paragraphs.length > 0 || policyLines.length > 0

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <LinkButton href="/" icon={ArrowLeft}>
          Inicio
        </LinkButton>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>

        {hasContent ? (
          <div className="mt-8 space-y-4">
            {policyLines.length > 0 && (
              <>
                <ul className="space-y-2">
                  {policyLines.map((line) => (
                    <li key={line} className="flex gap-3 leading-relaxed text-ink/80">
                      <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-clay" />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-ink/70">
                  Los plazos se miden desde la hora de entrada, las{' '}
                  {(settings?.check_in_time ?? '13:00').slice(0, 5)} hora de Venezuela. En
                  la página de tu reserva verás las fechas exactas.
                </p>
                {paragraphs.length > 0 && <hr className="border-ink/10" />}
              </>
            )}

            {paragraphs.map((text, i) => (
              <p key={i} className="whitespace-pre-line leading-relaxed text-ink/80">
                {text}
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-ink/20 p-8 text-ink/70">
            <p>
              Todavía no hemos publicado este texto. Escríbenos y te contamos lo que
              necesites saber antes de reservar.
            </p>
            <p className="mt-4 text-sm">
              {settings?.business_email && (
                <a href={`mailto:${settings.business_email}`} className="underline">
                  {settings.business_email}
                </a>
              )}
              {settings?.business_phone && <> · {settings.business_phone}</>}
            </p>
          </div>
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
