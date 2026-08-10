import { AdminPlaceholder } from '@/components/admin-placeholder'

export const metadata = { title: 'Reservas' }

export default function Page() {
  return (
    <AdminPlaceholder
      title="Reservas"
      description="Lista completa con filtros, ficha de cada reserva y cambios de estado."
      bullets={[
        'Filtrar por estado, unidad y rango de fechas',
        'Ficha con datos del huésped, pagos y saldo pendiente',
        'Marcar entrada y salida, cancelar con motivo',
        'Crear una reserva a mano para las que entran por teléfono',
      ]}
      meanwhile={{ label: 'ver la ocupación en el calendario', href: '/admin/calendario' }}
    />
  )
}
