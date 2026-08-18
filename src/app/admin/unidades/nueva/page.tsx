import Link from 'next/link'
import { UnitForm } from '@/components/unit-form'

export const metadata = { title: 'Nueva unidad' }

export default function NewUnitPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/unidades" className="text-sm text-ink/70 hover:underline">
        ← Unidades
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nueva unidad</h1>
      <p className="mt-2 text-descripcion text-ink/70">
        Las fotos y amenidades se añaden después de crearla.
      </p>

      <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
        <UnitForm />
      </div>
    </main>
  )
}
