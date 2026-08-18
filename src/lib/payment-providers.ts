import type { PaymentMethod } from '@/types/database'

/**
 * Registro de proveedores de cobro.
 *
 * Hay dos naturalezas y conviene no mezclarlas:
 *
 * - **Manual.** El huésped paga por su cuenta y reporta el comprobante; una
 *   persona lo verifica. No necesita contrato ni API. Es como se cierra la
 *   mayoría de los pagos en Venezuela y **seguirá existiendo** aunque algún día
 *   haya pasarela: siempre habrá quien pague por Zelle.
 *
 * - **Pasarela.** El banco o procesador confirma el cobro por API y la reserva
 *   se confirma sola. Requiere contrato, credenciales y, en el caso venezolano,
 *   persona jurídica con RIF.
 *
 * Todo lo que hoy está en `pending` vive aquí y no en el código de reservas, para
 * que enchufarlo sea añadir una implementación y no tocar el dominio.
 */

export type ProviderStatus =
  /** Operativo hoy. */
  | 'active'
  /** Falta firmar con el banco o procesador. */
  | 'needs_contract'
  /** Contrato posible, faltan credenciales en el entorno. */
  | 'needs_keys'

export type PaymentProvider = {
  id: string
  label: string
  kind: 'manual' | 'gateway'
  status: ProviderStatus
  /** Métodos que cubre este proveedor. */
  methods: PaymentMethod[]
  /** Qué hace falta para activarlo. */
  requires: string[]
  note: string
}

export const PROVIDERS: PaymentProvider[] = [
  {
    id: 'manual',
    label: 'Reporte manual de comprobante',
    kind: 'manual',
    status: 'active',
    methods: ['pago_movil', 'transferencia', 'zelle', 'binance', 'paypal', 'usdt'],
    requires: [],
    note:
      'El huésped paga y reporta canal, referencia, monto, fecha y captura. Se verifica ' +
      'a mano desde la bandeja de pagos. No desaparece cuando entren las pasarelas.',
  },
  {
    id: 'stripe',
    label: 'Stripe · tarjetas internacionales',
    kind: 'gateway',
    status: 'needs_keys',
    methods: ['tarjeta'],
    requires: [
      'STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET en el entorno',
      'Para cobrar de verdad: entidad legal en un país soportado por Stripe',
    ],
    note:
      'En modo de prueba funciona entero sin verificación de negocio: sirve para ' +
      'desarrollar y validar el flujo. Venezuela no está entre los países donde Stripe ' +
      'permite activar cobros reales, así que el modo real queda supeditado a tener ' +
      'entidad en otro país o usar un intermediario que facture por ti.',
  },
  {
    id: 'c2p',
    label: 'C2P · débito de banco nacional',
    kind: 'gateway',
    status: 'needs_contract',
    methods: ['c2p'],
    requires: [
      'Persona jurídica con RIF',
      'Cuenta empresarial y contrato con el banco (Mercantil, BNC, Tesoro…) o con un agregador como Megasoft',
      'Credenciales de su API en el entorno',
    ],
    note:
      'El huésped genera una clave temporal en su app bancaria y el cobro se debita en ' +
      'tiempo real, con confirmación inmediata. Es el único rail venezolano que permite ' +
      'confirmar una reserva sin intervención humana.',
  },
  {
    id: 'tdd_nacional',
    label: 'Débito y crédito nacional · botón de pago',
    kind: 'gateway',
    status: 'needs_contract',
    methods: ['tarjeta'],
    requires: [
      'Persona jurídica con RIF',
      'Contrato de botón de pago con el banco adquirente',
      'Credenciales de su API en el entorno',
    ],
    note:
      'Tarjetas emitidas en Venezuela, cobradas en bolívares a tasa BCV. Requiere el ' +
      'mismo contrato bancario que C2P.',
  },
]

export const providerStatusLabel: Record<ProviderStatus, string> = {
  active: 'Operativo',
  needs_contract: 'Falta contrato bancario',
  needs_keys: 'Faltan credenciales',
}

export const providerStatusTone: Record<ProviderStatus, string> = {
  active: 'bg-moss/15 text-moss',
  needs_contract: 'bg-ink/8 text-ink/70',
  needs_keys: 'bg-amber-100 text-amber-900',
}
