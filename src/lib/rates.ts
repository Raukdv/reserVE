import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { businessToday } from '@/lib/business-date'

export type RateSummary = {
  /** Tasa oficial vigente, o null si no hay ninguna aplicable. */
  rate: number | null
  /** Fecha valor de esa tasa. */
  rateDate: string | null
  /** Cierto si la tasa vigente lleva más de 3 días: el alimentador falló. */
  stale: boolean
  /** Brecha del paralelo sobre el oficial, en fracción. Solo informativa. */
  gap: number | null
  /** Última lectura del paralelo. Nunca se cobra con ella. */
  parallel: number | null
  /**
   * Tasa ya publicada que **todavía no rige**.
   *
   * El BCV publica por la tarde para el siguiente día hábil, así que a partir de
   * media tarde suele haber dos cifras vivas: la que se cobra hoy y la que se
   * cobrará mañana. Enseñar solo una deja al operador cotizando con un número
   * distinto del que ve en su banco.
   */
  next: { rate: number; rateDate: string } | null
}

/**
 * Lectura única de las tasas para las páginas.
 *
 * Existe para que ninguna consulta suelta olvide filtrar `market = 'oficial'`:
 * desde que la tabla guarda también el paralelo, un `order by rate_date` sin
 * filtro puede devolver la tasa informal, y cobrar con ella es infracción a la
 * Ley de Precios Justos.
 */
export async function getRateSummary(): Promise<RateSummary> {
  const supabase = await createClient()

  /*
    El corte es el día del negocio, no el de UTC.

    Estaba con `new Date().toISOString()`, que es UTC, y Venezuela va cuatro
    horas por detrás: entre las 8 de la noche y la medianoche la tasa de mañana
    entraba como vigente antes de tiempo. Justo en las horas en que el BCV ya
    publicó, que es cuando más se nota.
  */
  const today = businessToday()

  const [{ data: rows }, { data: stale }, { data: gap }, { data: upcoming }] =
    await Promise.all([
      supabase
        .from('exchange_rates')
        .select('rate_date, usd_ves, market')
        .lte('rate_date', today)
        .order('rate_date', { ascending: false })
        .limit(10),
      supabase.rpc('rate_is_stale'),
      supabase.rpc('current_gap'),
      // La ya publicada para más adelante, si la hay.
      supabase
        .from('exchange_rates')
        .select('rate_date, usd_ves')
        .eq('market', 'oficial')
        .gt('rate_date', today)
        .order('rate_date')
        .limit(1)
        .maybeSingle(),
    ])

  const official = (rows ?? []).find((r) => r.market === 'oficial') ?? null
  const parallel = (rows ?? []).find((r) => r.market === 'paralelo') ?? null

  return {
    rate: official?.usd_ves ?? null,
    rateDate: official?.rate_date ?? null,
    stale: stale ?? true,
    gap: gap ?? null,
    parallel: parallel?.usd_ves ?? null,
    next: upcoming ? { rate: upcoming.usd_ves, rateDate: upcoming.rate_date } : null,
  }
}
