import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { unitMediaUrl } from '@/lib/media'
import { UnitForm } from '@/components/unit-form'
import { UnitPhotos } from '@/components/unit-photos'
import { UnitAmenities } from '@/components/unit-amenities'
import { DeleteUnitButton } from '@/components/delete-unit-button'

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

  const [{ data: unit }, { data: amenities }, { data: assigned }, { data: media }] =
    await Promise.all([
      supabase.from('units').select('*').eq('id', id).maybeSingle(),
      supabase.from('amenities').select('id, label').order('label'),
      supabase.from('unit_amenities').select('amenity_id').eq('unit_id', id),
      supabase
        .from('unit_media')
        .select('id, storage_path, sort_order')
        .eq('unit_id', id)
        .order('sort_order'),
    ])

  if (!unit) notFound()

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: unitMediaUrl(m.storage_path),
    sortOrder: m.sort_order,
  }))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/unidades" className="text-sm text-ink/50 hover:underline">
        ← Unidades
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{unit.name}</h1>
        {unit.is_published && (
          <Link
            href={`/alojamientos/${unit.slug}`}
            target="_blank"
            className="text-sm text-ink/50 underline"
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
          amenities={amenities ?? []}
          selected={(assigned ?? []).map((a) => a.amenity_id)}
        />

        <div className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-sm font-medium">Eliminar</h2>
          <p className="mt-1 text-sm text-ink/50">
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
