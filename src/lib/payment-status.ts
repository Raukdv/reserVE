import type { PaymentStatus } from '@/types/database'

/**
 * Cómo se nombra y se pinta cada estado de un pago.
 *
 * Estaba copiado en la ficha del panel y en la página del huésped, y ya habían
 * divergido en el gris. Aquí hay una sola definición.
 *
 * ## Pendiente y reembolsado no pueden ser el mismo gris
 *
 * Lo eran, y son cosas opuestas: uno es dinero que **falta por entrar** y el
 * otro dinero que **ya salió**. En una lista de movimientos, confundirlos es
 * leer mal la caja.
 *
 * Pendiente se lleva el peso —tinta plena y seminegrita— porque es lo que
 * todavía puede hacer algo. Reembolsado se queda recesivo: es un hecho cerrado y
 * la lista ya lo marca aparte, con el signo menos delante del importe.
 *
 * ## Por qué peso y no un color nuevo
 *
 * El ámbar ya está tomado por «por verificar», que es la bandeja del operador —
 * lo único que exige que alguien mire algo. Darle a «pendiente» otro tono
 * llamativo pondría dos avisos a competir, y el que de verdad pide acción
 * dejaría de destacar. El peso distingue sin gritar.
 */
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  /** Anunciado y sin llegar. Lo que falta por entrar. */
  pending: { label: 'Pendiente', tone: 'font-medium text-ink' },
  /** La bandeja del operador: hay un comprobante que alguien tiene que mirar. */
  verifying: { label: 'Por verificar', tone: 'text-amber-700' },
  approved: { label: 'Aprobado', tone: 'text-moss' },
  rejected: { label: 'Rechazado', tone: 'text-red-700' },
  /** Dinero que salió. Cerrado, y con el signo menos ya delante del importe. */
  refunded: { label: 'Reembolsado', tone: 'text-ink/60' },
}

/**
 * Estado de una cadena cualquiera, tolerando lo que no conozca.
 *
 * La base puede ganar un estado nuevo en una migración antes de que la interfaz
 * se entere. Devolver la cadena cruda es feo pero no rompe la página.
 */
export const paymentStatus = (status: string) =>
  PAYMENT_STATUS[status as PaymentStatus] ?? { label: status, tone: 'text-ink/60' }
