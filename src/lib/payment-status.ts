import type { PaymentStatus } from '@/types/database'

/**
 * Cómo se nombra y se pinta cada estado de un pago.
 *
 * Estaba copiado en la ficha del panel y en la página del huésped, y ya habían
 * divergido en el gris. Aquí hay una sola definición.
 *
 * ## Píldoras, no texto de color
 *
 * Eran cinco líneas de texto coloreado, y en una columna de tabla se leían todas
 * igual: había que fijarse en el matiz de unas letras pequeñas para saber si un
 * pago entró o se devolvió. La píldora da una forma que se distingue de un
 * vistazo, antes de leer.
 *
 * ## La regla es la misma que en los estados de reserva
 *
 * **Relleno para lo que ocurrió, contorno para lo que no.** Un cobro aprobado,
 * uno rechazado y una devolución son hechos consumados y van rellenos; un pago
 * pendiente todavía no ha pasado y va contorneado. Así se separan también en
 * blanco y negro, sin depender del color.
 *
 * ## Pendiente y reembolsado eran el mismo gris
 *
 * Y son cosas opuestas: uno es dinero que **falta por entrar** y el otro dinero
 * que **ya salió**. En una lista de movimientos, confundirlos es leer mal la
 * caja. Ahora uno va contorneado con tinta plena y el otro relleno y recesivo.
 *
 * ## Por qué el pendiente no lleva color propio
 *
 * El ámbar ya está tomado por «por verificar», que es la bandeja del operador —
 * lo único que exige que alguien mire algo. Darle a «pendiente» otro tono
 * llamativo pondría dos avisos a competir, y el que de verdad pide acción
 * dejaría de destacar. El contorno distingue sin gritar.
 *
 * ## Todas llevan borde
 *
 * Aunque sea transparente. Un contorno visible sobre una píldora rellena sin
 * borde la haría dos píxeles más alta, y en una tabla eso se ve como una fila
 * desalineada.
 */
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  /** Anunciado y sin llegar. Lo único que aún no ocurrió: va contorneado. */
  pending: {
    label: 'Pendiente',
    tone: 'border border-ink/40 font-medium text-ink',
  },
  /** La bandeja del operador: hay un comprobante que alguien tiene que mirar. */
  verifying: {
    label: 'Por verificar',
    tone: 'border border-transparent bg-amber-100 text-amber-900',
  },
  approved: {
    label: 'Aprobado',
    tone: 'border border-transparent bg-moss/15 text-moss',
  },
  rejected: {
    label: 'Rechazado',
    tone: 'border border-transparent bg-red-100 text-red-900',
  },
  /** Dinero que salió. Cerrado, y con el signo menos ya delante del importe. */
  refunded: {
    label: 'Reembolsado',
    tone: 'border border-transparent bg-ink/10 text-ink/70',
  },
}

/**
 * Estado de una cadena cualquiera, tolerando lo que no conozca.
 *
 * La base puede ganar un estado nuevo en una migración antes de que la interfaz
 * se entere. Devolver la cadena cruda es feo pero no rompe la página.
 */
export const paymentStatus = (status: string) =>
  PAYMENT_STATUS[status as PaymentStatus] ?? {
    label: status,
    tone: 'border border-transparent bg-ink/10 text-ink/70',
  }

/**
 * Forma de la píldora, sin el color.
 *
 * Vive aquí para que los tres sitios que la pintan no vayan cada uno con su
 * redondeo y su tamaño — que es exactamente cómo empezó a divergir el mapa que
 * este archivo vino a unificar.
 */
export const PILL_SHAPE = 'inline-block rounded-full px-2.5 py-1 text-xs'
