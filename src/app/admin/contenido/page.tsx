import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ContentSections } from '@/components/content-sections'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contenido' }

export default async function ContentPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('site_content').select('key, data')

  const content = Object.fromEntries(
    (rows ?? []).map((r) => [r.key, r.data as Record<string, unknown>]),
  )

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contenido</h1>
          <p className="mt-1 text-sm text-ink/55">
            Los textos de la página pública. Cada sección se guarda por separado.
          </p>
        </div>
        <Link href="/" target="_blank" className="text-sm text-ink/50 underline">
          Ver la web
        </Link>
      </div>

      <div className="mt-8">
        <ContentSections content={content} />
      </div>

      <p className="mt-8 text-xs text-ink/45">
        El nombre, el teléfono y la política de cancelación se editan en{' '}
        <Link href="/admin/ajustes" className="underline">
          Ajustes
        </Link>
        .
      </p>
    </main>
  )
}
