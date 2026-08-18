/**
 * Cargos aplicados a una estadía.
 *
 * Dos alcances: **generales**, que van a todas las unidades —IVA, tasa
 * turística— y **por unidad**, propios de ese alojamiento —limpieza, piscina,
 * traslado—.
 *
 * Y cuatro formas de calcularlos. La distinción que importa es que un porcentaje
 * necesita una base, y esa base son las noches más los cargos de monto: el IVA
 * grava el valor del servicio, incluida la limpieza, no solo el alojamiento.
 */

export type FeeKind = 'fixed' | 'per_night' | 'per_guest' | 'percent'

export type Fee = {
  id: string
  unit_id: string | null
  name: string
  kind: FeeKind
  amount: number
  description: string | null
  refundable: boolean
  is_active: boolean
  sort_order: number
}

/** Cargo ya calculado sobre una estadía concreta. */
export type AppliedFee = {
  name: string
  kind: FeeKind
  rate: number
  amount_usd: number
  refundable: boolean
  scope: 'general' | 'unit'
  base_usd?: number
}

export const FEE_KINDS: { value: FeeKind; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Monto por estadía', hint: 'Se cobra una vez, sin importar la duración.' },
  { value: 'per_night', label: 'Monto por noche', hint: 'Se multiplica por el número de noches.' },
  { value: 'per_guest', label: 'Monto por huésped', hint: 'Se multiplica por el número de huéspedes.' },
  { value: 'percent', label: 'Porcentaje', hint: 'Sobre las noches más los cargos de monto.' },
]

/** Cómo se expresa la tarifa: «15,00 USD», «16 %», «3,00 USD por huésped». */
export function feeRateLabel(kind: FeeKind, amount: number): string {
  const money = new Intl.NumberFormat('es-VE', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)

  switch (kind) {
    case 'percent':
      return `${amount} %`
    case 'per_night':
      return `${money} por noche`
    case 'per_guest':
      return `${money} por huésped`
    default:
      return money
  }
}

/** Lee el desglose congelado en la reserva, tolerando cualquier forma. */
export function parseAppliedFees(raw: unknown): AppliedFee[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f): AppliedFee => ({
      name: String(f.name ?? 'Cargo'),
      kind: (f.kind as FeeKind) ?? 'fixed',
      rate: Number(f.rate) || 0,
      amount_usd: Number(f.amount_usd) || 0,
      refundable: Boolean(f.refundable),
      scope: f.scope === 'general' ? 'general' : 'unit',
      base_usd: f.base_usd === undefined ? undefined : Number(f.base_usd),
    }))
    .filter((f) => f.amount_usd > 0)
}
