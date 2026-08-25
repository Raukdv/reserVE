import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { businessToday } from '@/lib/business-date'
import type { PaymentMethod } from '@/types/database'

/** Un mes de la serie. Todas las cifras en USD. */
export type RevenueMonth = {
  /** Primer día del mes, en ISO. */
  month: string
  /** Todo lo que entró, ya neto de IGTF desde la migración 0024. */
  charged: number
  /** Lo que salió por devoluciones. */
  refunded: number
  /** Impuesto recaudado menos el devuelto. No es ingreso. */
  tax: number
  /** IGTF recaudado. Tampoco es ingreso, y ya está fuera de `charged`. */
  igtf: number
  /** `charged − refunded − tax`. Lo que de verdad se quedó el negocio. */
  net: number
}

export type RevenueByMethod = {
  method: PaymentMethod
  amount: number
  count: number
}

export type Occupancy = { sold: number; available: number; ratio: number }

export type RevenueSummary = {
  months: RevenueMonth[]
  byMethod: RevenueByMethod[]
  occupancy: Occupancy
  /** Si el sistema está aplicando impuestos. Ver la migración `0037`. */
  vatEnabled: boolean
}

const num = (v: unknown) => Number(v ?? 0)

/**
 * Todo lo que necesita la sección de ingresos, en cuatro consultas.
 *
 * Las sumas las hace Postgres. Traer las filas de `payments` para sumarlas en el
 * navegador funciona con veinte reservas y deja de funcionar con dos mil: el
 * plan Hobby tiene tope de CPU y el gratuito de Supabase tope de egreso. Doce
 * filas agregadas cuestan lo mismo hoy que dentro de tres años.
 */
export async function getRevenueSummary(months = 12): Promise<RevenueSummary> {
  const supabase = await createClient()

  /*
    El día del negocio, no el de UTC.

    Con `new Date().toISOString()` —que es UTC— entre las ocho de la noche y la
    medianoche de Venezuela el último día del mes ya cuenta como el mes
    siguiente, y el panel enseñaría un mes vacío justo la noche del cierre.
  */
  const today = businessToday()

  const [{ data: serie }, { data: methods }, { data: occ }, { data: settings }] =
    await Promise.all([
      supabase.rpc('revenue_by_month', { p_months: months }),
      supabase.rpc('revenue_by_method', { p_month: today }),
      supabase.rpc('occupancy_for_month', { p_month: today }),
      supabase.from('app_settings').select('vat_enabled').single(),
    ])

  return {
    months: (serie ?? []).map((r) => ({
      month: String(r.month),
      charged: num(r.charged_usd),
      refunded: num(r.refunded_usd),
      tax: num(r.tax_usd),
      igtf: num(r.igtf_usd),
      net: num(r.net_usd),
    })),
    byMethod: (methods ?? []).map((r) => ({
      method: r.method as PaymentMethod,
      amount: num(r.amount_usd),
      count: num(r.movimientos),
    })),
    occupancy: occ ?? { sold: 0, available: 0, ratio: 0 },
    vatEnabled: settings?.vat_enabled ?? false,
  }
}
