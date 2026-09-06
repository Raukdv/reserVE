/**
 * El código de reserva, tal como lo teclea una persona.
 *
 * Los códigos se generan en base32 de Crockford —ver la migración `0039`— y ese
 * alfabeto tiene una segunda mitad que no es el alfabeto: **al leer se perdona
 * lo que se confunde al escribir**.
 *
 * La reserva se toma por WhatsApp o por teléfono, así que el código se dicta en
 * voz alta más de lo que parece. Quien oye «cero» escribe `O` la mitad de las
 * veces, y quien oye «uno» escribe `I` o `L`. Sin esto, el código simplemente no
 * resuelve y el huésped se queda fuera de su propia reserva sin saber por qué.
 *
 * ## Por qué aquí y no en la base
 *
 * Quince funciones de Postgres buscan por código —`get_booking`,
 * `report_payment`, `staff_cancel_booking`…— y varias mueven dinero. Meterles
 * una normalización a todas es tocar mucho para arreglar un problema que solo
 * existe en un punto: donde un humano escribe.
 *
 * Los caminos del personal reciben el código de un enlace, nunca del teclado.
 * Así que esto se aplica en la frontera del huésped y la base sigue guardando y
 * comparando la forma canónica.
 */

/** Lo que Crockford manda aceptar como equivalente al escribir. */
const EQUIVALENCIAS: Record<string, string> = {
  O: '0',
  I: '1',
  L: '1',
}

/**
 * Deja un código tecleado en su forma canónica.
 *
 * `o-950d7da` → `0950D7DA` · `trwd 0masaj` → `TRWD0MASAJ`
 *
 * Quita también guiones y espacios: la gente los mete al copiar de un mensaje, y
 * Crockford los admite como separadores de cortesía.
 */
export function normalizeBookingCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[OIL]/g, (c) => EQUIVALENCIAS[c])
}
