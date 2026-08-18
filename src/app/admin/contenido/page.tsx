import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ContentSections } from '@/components/content-sections'
import { SiteImages } from '@/components/site-images'
import { siteMediaUrl } from '@/lib/media'
import { ExternalLink } from 'lucide-react'
import { LinkButton } from '@/components/link-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contenido' }

export default async function ContentPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('site_content').select('key, data')

  const content = Object.fromEntries(
    (rows ?? []).map((r) => [r.key, r.data as Record<string, unknown>]),
  )

  /*
    Aquí se consulta `site_media` directamente y no con el helper `siteImages()`:
    ese devuelve solo URL, que es lo que necesita la web pública, y el panel
    necesita además el id de cada fila para poder borrarla.
  */
  // Todas las fotos del sitio, con su sección: la galería es una sola y cada
  // foto lleva encima a dónde va.
  const { data: mediaRows } = await supabase
    .from('site_media')
    .select('id, section_key, storage_path')
    .order('section_key')
    .order('sort_order')
    .limit(60)

  const images = (mediaRows ?? []).map((row) => ({
    id: row.id,
    url: siteMediaUrl(row.storage_path),
    section: row.section_key,
  }))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contenido</h1>
          <p className="mt-1 text-descripcion text-ink/70">
            Los textos de la página pública. Cada sección se guarda por separado.
          </p>
        </div>
        <LinkButton href="/" icon={ExternalLink} external className="shrink-0">
          Ver la web
        </LinkButton>
      </div>

      <div className="mt-8">
        <SiteImages images={images} />

        <div className="mt-5">
          <ContentSections content={content} />
        </div>
      </div>

      <p className="mt-8 text-xs text-ink/60">
        El nombre, el teléfono y la política de cancelación se editan en{' '}
        <Link href="/admin/ajustes" className="underline">
          Ajustes
        </Link>
        .
      </p>
    </main>
  )
}
