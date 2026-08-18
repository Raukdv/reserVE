import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { unitMediaUrl } from '@/lib/media'
import { MAX_PHOTOS_PER_UNIT } from '@/lib/media-limits'
import { UnitForm } from '@/components/unit-form'
import { UnitPhotos } from '@/components/unit-photos'
import { UnitAmenities } from '@/components/unit-amenities'
import { DeleteUnitButton } from '@/components/delete-unit-button'
import { FeesEditor } from '@/components/fees-editor'
import type { Amenity } from '@/lib/amenities'
import type { Fee } from '@/lib/fees'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('units').select('name').eq('id', id).maybeSingle()
  return { title: data?.name ?? 'Unidad' }
}

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: amenities }, { data: assigned }, { data: media }, { data: fees }] =
    await Promise.all([
      supabase.from('units').select('*').eq('id', id).maybeSingle(),
      supabase.from('amenities').select('*').order('category').order('sort_order'),
      supabase.from('unit_amenities').select('amenity_id').eq('unit_id', id),
      supabase
        .from('unit_media')
        .select('id, storage_path, sort_order')
        .eq('unit_id', id)
        .order('sort_order')
        .limit(MAX_PHOTOS_PER_UNIT),
      supabase.from('fees').select('*').eq('unit_id', id).order('sort_order').order('name'),
    ])

  if (!unit) notFound()

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: unitMediaUrl(m.storage_path),
    sortOrder: m.sort_order,
  }))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/unidades" className="text-sm text-ink/70 hover:underline">
        ← Unidades
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{unit.name}</h1>
        {unit.is_published && (
          <Link
            href={`/alojamientos/${unit.slug}`}
            target="_blank"
            className="text-sm text-ink/70 underline"
          >
            Ver en la web
          </Link>
        )}
      </div>

      <div className="mt-8 space-y-5">
        <div className="rounded-2xl border border-ink/10 bg-white p-6">
          <UnitForm unit={unit} />
        </div>

        <UnitPhotos unitId={unit.id} photos={photos} />

        <UnitAmenities
          unitId={unit.id}
          amenities={(amenities ?? []) as Amenity[]}
          selected={(assigned ?? []).map((a) => a.amenity_id)}
        />

        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Cargos de esta unidad</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            Se suman a las noches solo en este alojamiento. Los{' '}
            <Link href="/admin/cargos" className="underline">
              generales
            </Link>{' '}
            se aplican además a todas.
          </p>
          <div className="mt-4">
            <FeesEditor
              fees={(fees ?? []) as Fee[]}
              unitId={unit.id}
              emptyHint="Sin cargos propios. Solo se cobran las noches y los cargos generales."
            />
          </div>
        </section>

        <div className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Eliminar</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            Solo si no tiene reservas. Con historial, despublícala en su lugar: borrarla
            perdería el registro de quién se alojó y qué pagó.
          </p>
          <div className="mt-4">
            <DeleteUnitButton id={unit.id} name={unit.name} />
          </div>
        </div>
      </div>
    </main>
  )
}
