import 'server-only'

import { createClient } from '@/lib/supabase/server'

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

  const [{ data: rows }, { data: stale }, { data: gap }] = await Promise.all([
    supabase
      .from('exchange_rates')
      .select('rate_date, usd_ves, market')
      .lte('rate_date', new Date().toISOString().slice(0, 10))
      .order('rate_date', { ascending: false })
      .limit(10),
    supabase.rpc('rate_is_stale'),
    supabase.rpc('current_gap'),
  ])

  const official = (rows ?? []).find((r) => r.market === 'oficial') ?? null
  const parallel = (rows ?? []).find((r) => r.market === 'paralelo') ?? null

  return {
    rate: official?.usd_ves ?? null,
    rateDate: official?.rate_date ?? null,
    stale: stale ?? true,
    gap: gap ?? null,
    parallel: parallel?.usd_ves ?? null,
  }
}
