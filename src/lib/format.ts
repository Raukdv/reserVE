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
