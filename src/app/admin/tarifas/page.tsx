import { AdminPlaceholder } from '@/components/admin-placeholder'

export const metadata = { title: 'Tarifas' }

export default function Page() {
  return (
    <AdminPlaceholder
      title="Tarifas"
      description="Precio base y temporadas por unidad."
      bullets={[
        'Temporadas con rango de fechas y precio por noche',
        'Mínimo de noches propio de cada temporada',
        'Aviso al solapar dos temporadas sobre la misma unidad',
        'Tarifa de limpieza',
      ]}
    />
  )
}
