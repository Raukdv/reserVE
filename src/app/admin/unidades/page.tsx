import { AdminPlaceholder } from '@/components/admin-placeholder'

export const metadata = { title: 'Unidades' }

export default function Page() {
  return (
    <AdminPlaceholder
      title="Unidades"
      description="Alta y edición de los alojamientos, sus fotos y sus reglas."
      bullets={[
        'Crear, editar y despublicar unidades',
        'Subir y ordenar fotos',
        'Amenidades por unidad',
        'Capacidad, mínimo y máximo de noches, antelación exigida',
      ]}
      meanwhile={{ label: 'ver el catálogo público', href: '/alojamientos' }}
    />
  )
}
