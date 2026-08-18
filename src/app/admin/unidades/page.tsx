import Link from 'next/link'
import { Plus } from 'lucide-react'
import { LinkButton } from '@/components/link-button'
import { createClient } from '@/lib/supabase/server'
import { unitMediaUrl } from '@/lib/media'
import { usd } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Unidades' }

export default async function UnitsPage() {
  const supabase = await createClient()

  const { data: units } = await supabase
    .from('units')
    .select(`
      id, name, slug, max_guests, bedrooms, base_price_usd, is_published, sort_order,
      unit_media ( storage_path, sort_order )
    `)
    .order('sort_order')

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Unidades</h1>
          <p className="mt-1 text-descripcion text-ink/70">
            Los alojamientos que se pueden reservar.
          </p>
        </div>
        <Link
          href="/admin/unidades/nueva"
          className="rounded-xl bg-ink px-5 py-2.5 text-sm text-sand transition hover:bg-ink/85"
        >
          Nueva unidad
        </Link>
      </div>

      {units && units.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {units.map((unit) => {
            const media = (unit.unit_media ?? []).sort(
              (a, b) => a.sort_order - b.sort_order,
            )
            const cover = media[0]

            return (
              <li key={unit.id}>
                <Link
                  href={`/admin/unidades/${unit.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-white p-4 transition hover:border-ink/30"
                >
                  {cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={unitMediaUrl(cover.storage_path)}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded-lg bg-ink/5 object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink/20 text-[11px] text-ink/60">
                      Sin foto
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-medium">{unit.name}</strong>
                      {!unit.is_published && (
                        <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/70">
                          Sin publicar
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-ink/70">
                      {usd(unit.base_price_usd)} / noche · {unit.max_guests} huéspedes ·{' '}
                      {unit.bedrooms} hab. · {media.length} foto
                      {media.length === 1 ? '' : 's'}
                    </span>
                  </span>

                  <span className="shrink-0 text-sm text-ink/60">Editar →</span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-ink/20 p-12 text-center">
          <p className="text-sm text-ink/70">Todavía no hay unidades.</p>
          <LinkButton href="/admin/unidades/nueva" icon={Plus} tone="principal" className="mt-4">
            Crear la primera
          </LinkButton>
        </div>
      )}
    </main>
  )
}
