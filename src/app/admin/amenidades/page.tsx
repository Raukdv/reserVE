import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AmenitiesCatalog } from '@/components/amenities-catalog'
import type { Amenity } from '@/lib/amenities'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Amenidades' }

export default async function AmenitiesPage() {
  const supabase = await createClient()

  const [{ data: amenities }, { data: links }] = await Promise.all([
    supabase.from('amenities').select('*').order('category').order('sort_order'),
    supabase.from('unit_amenities').select('amenity_id'),
  ])

  // Cuántas unidades usan cada una, para avisar antes de borrarla.
  const usage: Record<string, number> = {}
  for (const link of links ?? []) {
    usage[link.amenity_id] = (usage[link.amenity_id] ?? 0) + 1
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Amenidades</h1>
      <p className="mt-2 text-descripcion text-ink/70">
        El catálogo del que eligen las unidades. Lo que marques en cada{' '}
        <Link href="/admin/unidades" className="underline">
          alojamiento
        </Link>{' '}
        sale de aquí.
      </p>

      <div className="mt-8">
        <AmenitiesCatalog amenities={(amenities ?? []) as Amenity[]} usage={usage} />
      </div>
    </main>
  )
}
