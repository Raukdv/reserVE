import type { PaymentMethod } from '@/types/database'

/**
 * Definición de cada canal de pago: en qué moneda se paga, cómo se llama el dato
 * de origen y qué cuenta como referencia.
 *
 * Compartido entre el formulario del huésped y la bandeja de verificación del
 * administrador, para que ambos hablen del mismo campo con el mismo nombre.
 */
export type MethodSpec = {
  label: string
  currency: 'USD' | 'VES'
  /** Cómo se llama el dato de quien envía el dinero. */
  originLabel: string
  originPlaceholder: string
  /** Cómo llama ese canal a su identificador de transacción. */
  referenceLabel: string
  referencePlaceholder: string
  /** Qué debe comprobar el administrador antes de aprobar. */
  verifyHint: string
  /** Si el canal exige identificar al titular que paga. */
  needsPayer: boolean
}

export const METHODS: Record<PaymentMethod, MethodSpec> = {
  pago_movil: {
    label: 'Pago Móvil',
    currency: 'VES',
    originLabel: 'Teléfono desde el que pagaste',
    originPlaceholder: '0412 555 0134',
    referenceLabel: 'Número de referencia',
    referencePlaceholder: '004512789',
    verifyHint: 'Confirma la referencia y el monto exacto en el estado de cuenta.',
    needsPayer: true,
  },
  transferencia: {
    label: 'Transferencia bancaria',
    currency: 'VES',
    originLabel: 'Banco de origen',
    originPlaceholder: 'Banesco',
    referenceLabel: 'Número de referencia',
    referencePlaceholder: '004512789',
    verifyHint: 'Confirma la referencia contra el movimiento bancario.',
    needsPayer: true,
  },
  zelle: {
    label: 'Zelle',
    currency: 'USD',
    originLabel: 'Correo o teléfono del remitente',
    originPlaceholder: 'nombre@correo.com',
    referenceLabel: 'Número de confirmación',
    referencePlaceholder: 'ZL-8842019',
    verifyHint: 'Confirma el correo del remitente y el ID en tu cuenta Zelle.',
    needsPayer: true,
  },
  binance: {
    label: 'Binance Pay',
    currency: 'USD',
    originLabel: 'Usuario o correo de Binance',
    originPlaceholder: 'usuario@correo.com',
    referenceLabel: 'ID de orden',
    referencePlaceholder: '178234567890',
    verifyHint: 'Confirma el ID de orden en el historial de Binance Pay.',
    needsPayer: false,
  },
  paypal: {
    label: 'PayPal',
    currency: 'USD',
    originLabel: 'Correo de PayPal',
    originPlaceholder: 'nombre@correo.com',
    referenceLabel: 'ID de transacción',
    referencePlaceholder: '8XY12345AB678901C',
    verifyHint: 'Confirma el ID de transacción en PayPal.',
    needsPayer: false,
  },
  usdt: {
    label: 'USDT',
    currency: 'USD',
    originLabel: 'Dirección de origen',
    originPlaceholder: '0x… o TR…',
    referenceLabel: 'Hash de la transacción',
    referencePlaceholder: '0x9f2c…',
    verifyHint: 'Confirma el hash en el explorador de la red correspondiente.',
    needsPayer: false,
  },
  c2p: {
    label: 'C2P',
    currency: 'VES',
    originLabel: 'Teléfono asociado',
    originPlaceholder: '0412 555 0134',
    referenceLabel: 'Código de aprobación',
    referencePlaceholder: '123456',
    verifyHint: 'Aprobación automática del banco; no requiere revisión manual.',
    needsPayer: true,
  },
  tarjeta: {
    label: 'Tarjeta',
    currency: 'USD',
    originLabel: 'Últimos 4 dígitos',
    originPlaceholder: '4242',
    referenceLabel: 'Código de autorización',
    referencePlaceholder: '004512',
    verifyHint: 'Confirma la autorización en el punto de venta.',
    needsPayer: true,
  },
  efectivo: {
    label: 'Efectivo',
    currency: 'USD',
    originLabel: 'Entregado a',
    originPlaceholder: 'Recepción',
    referenceLabel: 'Recibo',
    referencePlaceholder: '—',
    verifyHint: 'Solo lo registra el personal, en persona.',
    needsPayer: false,
  },
}

/**
 * Canales que el huésped puede reportar desde la web.
 *
 * `c2p` queda fuera hasta que exista integración bancaria —se aprobaría solo—,
 * y `tarjeta` y `efectivo` porque ocurren en persona: los registra el personal.
 */
export const GUEST_METHODS: PaymentMethod[] = [
  'pago_movil',
  'transferencia',
  'zelle',
  'binance',
  'paypal',
  'usdt',
]
