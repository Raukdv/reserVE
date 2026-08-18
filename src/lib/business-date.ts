import { serverEnv } from '@/lib/env'

/**
 * Hoy según el negocio, en `YYYY-MM-DD`.
 *
 * Postgres corre en UTC y Venezuela va cuatro horas por detrás, así que entre
 * las 8 de la noche y la medianoche `new Date().toISOString()` ya devuelve la
 * fecha de mañana. En un panel que dice «llegadas de hoy» eso significa enseñar
 * las de mañana durante las cuatro horas en que más se usa: las de la tarde.
 *
 * La base ya resuelve esto con `business_today()`. Esta es su contraparte para
 * el código que compone consultas desde Next, para que las dos mitades
 * coincidan en qué día es.
 *
 * `en-CA` se elige por su formato, no por el idioma: es el que produce
 * `YYYY-MM-DD`, que es lo que espera Postgres para una `date`.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: serverEnv().BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Días completos entre dos fechas `YYYY-MM-DD`.
 *
 * A mediodía UTC para que ningún cambio de horario mueva el resultado un día:
 * son fechas sin hora, y lo único que interesa es cuántos días las separan.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}
