import type { BookingStatus } from '@/types/database'

/**
 * Cómo se nombra y se pinta cada estado de una reserva.
 *
 * Estaba copiado en tres sitios del panel —resumen, lista y ficha— y ya habían
 * divergido: el resumen no tenía `no_show` y enseñaba `no_show` en crudo al
 * operador, y la ficha decía «Pendiente de pago» donde las listas decían
 * «Pendiente». Aquí hay una sola definición.
 *
 * ## Los cuatro estados cerrados no son lo mismo
 *
 * Completada, cancelada, no-show y expirada compartían el mismo gris. Vistos en
 * una lista eran indistinguibles, y son cuatro finales muy distintos: uno salió
 * bien, otro lo deshizo el huésped, en otro se retuvo el dinero y en el último
 * no llegó a haber dinero.
 *
 * Se separan por **forma antes que por color**: relleno para lo que ocurrió,
 * contorno para lo que se deshizo, contorno punteado para lo que nunca llegó a
 * ser. Así se distinguen también en una captura en blanco y negro o para quien
 * no separa bien los tonos, que es lo que el color solo no garantiza.
 *
 * El único que gana color propio es el no-show: es el que costó dinero.
 *
 * ## Todos llevan borde
 *
 * Aunque sea transparente. Un contorno visible sobre una píldora rellena sin
 * borde la haría dos píxeles más alta, y en una lista eso se nota como una fila
 * desalineada.
 */
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  // Lo único que reclama acción.
  pending: {
    label: 'Pendiente de pago',
    tone: 'border border-transparent bg-amber-100 text-amber-900',
  },
  confirmed: {
    label: 'Confirmada',
    tone: 'border border-transparent bg-moss/15 text-moss',
  },
  checked_in: {
    label: 'Hospedado',
    tone: 'border border-transparent bg-tide/15 text-tide',
  },

  // Cerradas. Recesivas a propósito: son la mayoría de las filas y no deben
  // competir con lo que sí pide algo.
  completed: {
    label: 'Completada',
    tone: 'border border-transparent bg-ink/10 text-ink/70',
  },
  cancelled: {
    label: 'Cancelada',
    tone: 'border border-ink/30 text-ink/60',
  },
  no_show: {
    label: 'No se presentó',
    tone: 'border border-transparent bg-red-100 text-red-900',
  },
  // El texto va al mismo 60 % que «cancelada», no más tenue: `ink/45` sobre
  // blanco da 2,99:1 y no llega al 4,5:1 que pide la AA. Lo que la separa es el
  // punteado, que es forma y no color — que era el punto.
  expired: {
    label: 'Expirada',
    tone: 'border border-dashed border-ink/30 text-ink/60',
  },
}

/**
 * Estado de una cadena cualquiera, tolerando lo que no conozca.
 *
 * La base puede ganar un estado nuevo en una migración antes de que la interfaz
 * se entere. Devolver la cadena cruda es feo pero no rompe la página, y se ve
 * enseguida que falta añadirlo aquí.
 */
export const bookingStatus = (status: string) =>
  BOOKING_STATUS[status as BookingStatus] ?? {
    label: status,
    tone: 'border border-transparent bg-ink/10 text-ink/70',
  }

/** Orden en el que se ofrecen en un filtro: primero lo que pide algo. */
export const BOOKING_STATUS_ORDER: BookingStatus[] = [
  'pending', 'confirmed', 'checked_in',
  'completed', 'cancelled', 'no_show', 'expired',
]
