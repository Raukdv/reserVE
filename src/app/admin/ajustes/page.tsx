import { AdminPlaceholder } from '@/components/admin-placeholder'

export const metadata = { title: 'Ajustes' }

export default function Page() {
  return (
    <AdminPlaceholder
      title="Ajustes"
      description="Datos del negocio, condiciones de cobro y cuentas de pago."
      bullets={[
        'Nombre, correo y teléfono del negocio',
        'Porcentaje de anticipo y plazo antes de liberar las fechas',
        'Cuentas de cobro: Pago Móvil, transferencia, Zelle, Binance, USDT',
        'Política de cancelación',
        'IGTF, solo si el negocio es contribuyente especial',
      ]}
    />
  )
}
