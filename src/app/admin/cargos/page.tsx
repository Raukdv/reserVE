import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FeesEditor } from '@/components/fees-editor'
import type { Fee } from '@/lib/fees'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cargos' }

export default async function FeesPage() {
  const supabase = await createClient()

  const [{ data: fees }, { data: units }] = await Promise.all([
    supabase.from('fees').select('*').order('sort_order').order('name'),
    supabase.from('units').select('id, name').order('sort_order'),
  ])

  const all = (fees ?? []) as Fee[]
  const general = all.filter((f) => f.unit_id === null)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Cargos</h1>
      <p className="mt-2 text-descripcion text-ink/70">
        Lo que se suma al precio de las noches. Se calculan en dos pasadas: primero los
        montos, que junto a las noches forman la base, y después los porcentajes sobre esa
        base — igual que el IVA grava el servicio completo, limpieza incluida.
      </p>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Generales</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Se aplican a todas las unidades. Impuestos, tasas turísticas, recargos.
        </p>
        <div className="mt-4">
          <FeesEditor
            fees={general}
            emptyHint="Sin cargos generales. El precio es solo el de las noches más lo que tenga cada unidad."
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold">Por unidad</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Propios de cada alojamiento: limpieza, piscina, traslado. Se editan en la ficha
          de la unidad.
        </p>

        {units && units.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {units.map((unit) => {
              const own = all.filter((f) => f.unit_id === unit.id)
              return (
                <li key={unit.id}>
                  <Link
                    href={`/admin/unidades/${unit.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white p-4 text-sm transition hover:border-ink/30"
                  >
                    <span className="font-medium">{unit.name}</span>
                    <span className="text-ink/70">
                      {own.length === 0
                        ? 'Sin cargos propios'
                        : own.map((f) => f.name).join(' · ')}
                      {' →'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-ink/20 p-8 text-center text-sm text-ink/70">
            No hay unidades todavía.
          </p>
        )}
      </section>

      <p className="mt-10 text-xs text-ink/60">
        Cambiar o borrar un cargo no altera las reservas ya hechas: cada una guarda su
        desglose tal como se aplicó.
      </p>
    </main>
  )
}
