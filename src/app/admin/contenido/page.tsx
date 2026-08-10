import { AdminPlaceholder } from '@/components/admin-placeholder'

export const metadata = { title: 'Contenido' }

export default function Page() {
  return (
    <AdminPlaceholder
      title="Contenido"
      description="Textos de la página pública, editables sin tocar código."
      bullets={[
        'Portada: titular y subtítulo',
        'Sobre el negocio, servicios y cómo llegar',
        'Preguntas frecuentes',
        'Datos de contacto',
      ]}
      meanwhile={{ label: 'ver la página pública', href: '/' }}
    />
  )
}
