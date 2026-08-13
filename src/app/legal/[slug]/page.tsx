import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SiteHeader, SiteFooter } from '@/components/site-chrome'

export const revalidate = 300

/**
 * Páginas legales.
 *
 * El texto vive en `site_content` y no en el código: es vinculante y lo redacta
 * el negocio, no quien programa. Cambiarlo no debería requerir un despliegue.
 */
const PAGES = {
  condiciones: { key: 'legal_condiciones', fallbackTitle: 'Condiciones de reserva' },
  cancelacion: { key: 'legal_cancelacion', fallbackTitle: 'Política de cancelación' },
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
      .select('business_name, business_email, business_phone, cancellation_policy')
      .single(),
    supabase.from('site_content').select('data').eq('key', page.key).maybeSingle(),
  ])

  const content = (row?.data ?? {}) as { title?: string; body?: string }
  const businessName = settings?.business_name ?? 'reserVE'
  const title = content.title?.trim() || page.fallbackTitle

  // La política corta de Ajustes es la que se muestra en el checkout. Si aún no
  // se ha redactado la versión larga, se enseña esa en vez de una página vacía:
  // el huésped ya la aceptó al reservar y tiene derecho a poder consultarla.
  const body =
    content.body?.trim() ||
    (slug === 'cancelacion' ? settings?.cancellation_policy?.trim() ?? '' : '')

  const paragraphs = body ? body.split(/\n{2,}/).filter(Boolean) : []

  return (
    <>
      <SiteHeader businessName={businessName} />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-ink/50 hover:underline">
          ← Inicio
        </Link>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>

        {paragraphs.length > 0 ? (
          <div className="mt-8 space-y-4">
            {paragraphs.map((text, i) => (
              <p key={i} className="whitespace-pre-line leading-relaxed text-ink/75">
                {text}
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-ink/20 p-8 text-ink/60">
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
