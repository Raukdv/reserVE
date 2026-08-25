const usdFormatter = new Intl.NumberFormat('es-VE', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

// Formato decimal y sufijo manual: Intl con currency VES rinde "Bs.S", que es la
// nomenclatura del bolívar soberano de 2018 y hoy está fuera de uso.
const vesFormatter = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const usd = (value: number) => usdFormatter.format(value)
export const ves = (value: number) => `${vesFormatter.format(value)} Bs`

/**
 * Formateadores de porcentaje, uno por número de decimales.
 *
 * Se cachean por lo mismo que los de moneda: construir un `Intl.NumberFormat`
 * no es gratis y estos se llaman dentro de bucles de renderizado.
 */
const percentFormatters = new Map<number, Intl.NumberFormat>()

/**
 * Porcentaje a partir de la **fracción**, no del número ya multiplicado.
 *
 * `percent(0.3)` → `30%` · `percent(0.145395, 1)` → `14,5%`
 *
 * ## Por qué existe
 *
 * El `× 100` estaba suelto en una docena de sitios y había derivado en tres
 * formatos distintos para lo mismo:
 *
 * ```
 * Math.round(x * 100) + '%'                        → 30%
 * (x * 100).toFixed(1) + '%'                       → 14.5%     ← punto inglés
 * (x * 100).toFixed(1).replace('.', ',') + ' %'    → 3,0 %
 * ```
 *
 * El segundo no era solo inconsistente: metía un separador decimal inglés en una
 * interfaz en español, justo al lado de importes que sí usan coma. `Intl` con
 * `es-VE` resuelve las dos cosas y además se come los ceros finales —`30%`, no
 * `30,0%`—, que es como se escribe.
 *
 * ## La fracción, no el porcentaje
 *
 * La base guarda multiplicadores: `total_usd * deposit_ratio`, con la invariante
 * `<= 1`. La interfaz enseña «30 %». Esta función es la frontera, y recibe lo
 * que hay en la base para que nadie tenga que acordarse de multiplicar.
 *
 * ## Dónde no va
 *
 * - **En el valor por defecto de un campo de formulario.** Ahí hace falta el
 *   número pelado —`30`— y no una cadena con el signo.
 * - **En anchuras y trazos.** Un `width: 45%` de CSS o un `stroke-dasharray` son
 *   geometría, no texto; el `× 100` de esos sitios se queda donde está.
 * - **En cadenas de diagnóstico.** Las de `bcv.ts` acaban en `rate_fetch_log` y
 *   las lee quien depura, no el operador. Una coma decimal ahí solo estorba a un
 *   `grep`.
 */
export function percent(fraction: number, decimals = 0): string {
  let formatter = percentFormatters.get(decimals)

  if (!formatter) {
    formatter = new Intl.NumberFormat('es-VE', {
      style: 'percent',
      maximumFractionDigits: decimals,
    })
    percentFormatters.set(decimals, formatter)
  }

  return formatter.format(fraction)
}

/** Precio en la moneda o monedas que el negocio haya configurado mostrar. */
export function price(
  amountUsd: number,
  rate: number | null,
  display: 'usd' | 'ves' | 'both',
) {
  if (display === 'usd' || rate === null) return usd(amountUsd)
  if (display === 'ves') return ves(amountUsd * rate)
  return `${usd(amountUsd)} · ${ves(amountUsd * rate)}`
}

const longDate = new Intl.DateTimeFormat('es-VE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Formatea una fecha `YYYY-MM-DD` de Postgres.
 *
 * Se fuerza timeZone UTC a propósito: `new Date('2026-08-10')` se interpreta
 * como medianoche UTC, y renderizarla en la zona de Venezuela (UTC−4) la
 * mostraría como el día anterior.
 */
export const dateLabel = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`))

/** Convierte un daterange de Postgres "[2026-08-10,2026-08-14)" en sus extremos. */
export function parseRange(range: string): { from: string; to: string } {
  const [from, to] = range.slice(1, -1).split(',')
  return { from: from.replace(/"/g, ''), to: to.replace(/"/g, '') }
}

/** Construye un daterange semiabierto para enviarlo a Postgres. */
export const toRange = (from: string, to: string) => `[${from},${to})`
