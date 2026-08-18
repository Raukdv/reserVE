/**
 * Política de cancelación por tramos.
 *
 * Cada tramo dice hasta cuándo se puede cancelar y qué se devuelve. Se ordenan
 * de mayor a menor antelación y se aplica el primero que todavía se cumple; lo
 * que no cubre ninguno no se reembolsa.
 *
 * Hay **dos formas de reembolso**, porque las políticas reales no se dejan
 * describir con una sola:
 *
 * - `percent` — un porcentaje del total por noches. Con 100 vuelve todo,
 *   cargos incluidos.
 * - `nights` — se pierden las primeras N noches y se devuelve el resto. Es el
 *   «todas las noches menos la primera» de las plataformas.
 *
 * Qué pasa con los cargos por debajo del 100 % lo decide cada cargo, no el
 * tramo: `cancellation_quote()` devuelve los de monto marcados `refundable` en
 * la misma proporción que las noches conservadas, y los de porcentaje siguen a
 * su base. Los no reembolsables no vuelven nunca. Por eso el texto público habla
 * de «cargos reembolsables» y no nombra la limpieza: la limpieza es un cargo
 * más desde que dejó de ser una columna, y puede estar marcada de cualquiera de
 * las dos formas.
 *
 * Guardar horas y no fechas es lo que permite mostrar plazos reales para cada
 * reserva en lugar de una regla que el huésped tenga que traducir.
 */

/**
 * `forfeit_nights` se nombra desde el huésped: son las noches que **no**
 * recupera. Visto desde el negocio son las que retiene cobradas. Los dos
 * enunciados describen la misma cantidad, así que la interfaz de administración
 * usa el segundo —«noches que cobras igual»— y la del huésped el primero.
 */
export type CancellationTier =
  | { hours_before: number; kind: 'percent'; refund_percent: number }
  | { hours_before: number; kind: 'nights'; forfeit_nights: number }

/**
 * Políticas con nombre, para elegir una en lugar de montarla a mano.
 *
 * Se calcan de las que publican Airbnb y Booking porque son las que el huésped
 * ya conoce, y porque son la respuesta a una duda razonable: un editor que te
 * deja añadir y quitar tramos sueltos se lee como si estuvieras apilando varias
 * políticas. No lo es —solo hay una, y vive en la fila única de `app_settings`—
 * pero la interfaz no lo dejaba claro.
 *
 * La escalera de dos o tres escalones **es** el estándar, no una rareza: Airbnb
 * reconstruyó su sistema el 1 de octubre de 2025 y las dos políticas que más
 * protegen al anfitrión, «Limitada» y «Firme», siguen teniendo un tramo
 * intermedio del 50 %. Reducir esto a un solo escalón habría dejado esas dos
 * fuera del alcance del operador.
 *
 * Los tramos por noches no aparecen aquí: son un caso menos común y siguen
 * disponibles en la política personalizada.
 */
export type PolicyPreset = {
  id: string
  label: string
  /** Para qué sirve, en términos del operador. */
  hint: string
  tiers: CancellationTier[]
}

const DAYS = 24

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'flexible',
    label: 'Flexible',
    hint: 'Llena más fechas. Asume cancelaciones de última hora.',
    tiers: [{ hours_before: 1 * DAYS, kind: 'percent', refund_percent: 100 }],
  },
  {
    id: 'moderada',
    label: 'Moderada',
    hint: 'El punto medio habitual.',
    tiers: [{ hours_before: 5 * DAYS, kind: 'percent', refund_percent: 100 }],
  },
  {
    id: 'limitada',
    label: 'Limitada',
    hint: 'Deja margen para revender la fecha sin perderlo todo.',
    tiers: [
      { hours_before: 14 * DAYS, kind: 'percent', refund_percent: 100 },
      { hours_before: 7 * DAYS, kind: 'percent', refund_percent: 50 },
    ],
  },
  {
    id: 'firme',
    label: 'Firme',
    hint: 'Protege temporada alta y estadías largas. Espanta a quien duda.',
    tiers: [
      { hours_before: 30 * DAYS, kind: 'percent', refund_percent: 100 },
      { hours_before: 7 * DAYS, kind: 'percent', refund_percent: 50 },
    ],
  },
]

/** Compara dos escaleras por contenido, ya ordenadas de mayor a menor plazo. */
const sameTiers = (a: CancellationTier[], b: CancellationTier[]) =>
  a.length === b.length &&
  a.every((t, i) => {
    const o = b[i]
    if (t.hours_before !== o.hours_before || t.kind !== o.kind) return false
    return t.kind === 'nights'
      ? t.forfeit_nights === (o as typeof t).forfeit_nights
      : t.refund_percent === (o as typeof t).refund_percent
  })

/**
 * Qué política tiene puesta el negocio, o `null` si es una propia.
 *
 * Se resuelve por contenido y no guardando el nombre: así una escalera creada
 * antes de que existieran los presets se reconoce sola, y editar una preset
 * hasta convertirla en otra la reetiqueta sin trucos.
 */
export function matchPreset(tiers: CancellationTier[]): PolicyPreset | null {
  const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before)
  return POLICY_PRESETS.find((p) => sameTiers(sorted, p.tiers)) ?? null
}

export type CancellationStep = {
  /** Instante límite de este tramo. */
  deadline: Date
  tier: CancellationTier
  daysBefore: number
}

const CARACAS = 'America/Caracas'

/** Título de la página pública cuando el operador no pone uno propio. */
export const POLICY_TITLE = 'Política de cancelación'

/**
 * Lee los tramos guardados en la columna jsonb.
 *
 * Tolera cualquier forma: la columna admite JSON arbitrario y una política mal
 * guardada no debe tumbar la página del huésped. Los tramos sin `kind` se
 * asumen de porcentaje, que es como existían antes de admitir los dos tipos.
 */
export function parseTiers(raw: unknown): CancellationTier[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t): CancellationTier => {
      const hours = Number(t.hours_before) || 0

      return t.kind === 'nights'
        ? {
            hours_before: hours,
            kind: 'nights',
            forfeit_nights: Math.max(1, Number(t.forfeit_nights) || 1),
          }
        : {
            hours_before: hours,
            kind: 'percent',
            refund_percent: Math.min(100, Math.max(0, Number(t.refund_percent) || 0)),
          }
    })
    .sort((a, b) => b.hours_before - a.hours_before)
}

/**
 * Instante de llegada.
 *
 * `checkIn` es una fecha sin hora (`YYYY-MM-DD`) y `checkInTime` la hora local
 * del negocio (`HH:MM`). Venezuela no aplica horario de verano, así que el
 * desfase es constante y se puede componer directamente.
 */
export function checkInMoment(checkIn: string, checkInTime: string): Date {
  return new Date(`${checkIn}T${checkInTime.slice(0, 5)}:00-04:00`)
}

export function cancellationSteps(
  tiers: CancellationTier[],
  checkIn: string,
  checkInTime: string,
): CancellationStep[] {
  const arrival = checkInMoment(checkIn, checkInTime)

  return [...tiers]
    .sort((a, b) => b.hours_before - a.hours_before)
    .map((tier) => ({
      deadline: new Date(arrival.getTime() - tier.hours_before * 3_600_000),
      tier,
      daysBefore: Math.round(tier.hours_before / 24),
    }))
}

/** Índice del tramo vigente, o −1 si ya vencieron todos. */
export const activeStepIndex = (steps: CancellationStep[], now: Date = new Date()) =>
  steps.findIndex((s) => now <= s.deadline)

const stamp = new Intl.DateTimeFormat('es-VE', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: CARACAS,
})

/** «31 de agosto, 1:00 p. m.» */
export const deadlineLabel = (date: Date) => stamp.format(date)

/** Titular corto del tramo. */
export function tierTitle(tier: CancellationTier): string {
  if (tier.kind === 'nights') return 'Reembolso parcial'
  if (tier.refund_percent >= 100) return 'Reembolso completo'
  if (tier.refund_percent <= 0) return 'Sin reembolso'
  return `Reembolso del ${tier.refund_percent} %`
}

/**
 * Qué pasa con los cargos cuando el reembolso es parcial.
 *
 * Una sola frase para los dos tipos de tramo, porque el servidor los trata
 * igual: lo decide la casilla «reembolsable» de cada cargo, no el tramo.
 */
const FEES_PARTIAL =
  'Los cargos reembolsables vuelven en la misma proporción; los que no lo son, no.'

/** Explicación en una frase, en los términos del huésped. */
export function tierDetail(tier: CancellationTier): string {
  if (tier.kind === 'nights') {
    const n = tier.forfeit_nights
    const nights =
      n === 1
        ? 'Se devuelven todas las noches menos la primera.'
        : `Se devuelven todas las noches menos las ${n} primeras.`
    return `${nights} ${FEES_PARTIAL}`
  }

  if (tier.refund_percent >= 100) {
    return 'Se devuelve el importe completo, cargos incluidos.'
  }
  if (tier.refund_percent <= 0) {
    return 'No se devuelve nada de lo pagado.'
  }
  return `Se devuelve el ${tier.refund_percent} % del total por noches. ${FEES_PARTIAL}`
}

/**
 * Descripción sin fechas, para donde todavía no hay reserva: la ficha del
 * alojamiento o las páginas legales.
 */
export function genericPolicy(tiers: CancellationTier[]): string[] {
  const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before)

  const lines = sorted.map((tier) => {
    const days = Math.round(tier.hours_before / 24)
    const when =
      days >= 1
        ? `Hasta ${days} día${days === 1 ? '' : 's'} antes de la llegada`
        : `Hasta ${tier.hours_before} hora${tier.hours_before === 1 ? '' : 's'} antes`

    return `${when}: ${tierTitle(tier).toLowerCase()}. ${tierDetail(tier)}`
  })

  lines.push('Pasado ese plazo, no hay reembolso.')
  return lines
}
