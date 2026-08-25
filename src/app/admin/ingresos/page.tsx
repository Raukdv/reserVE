import { getRevenueSummary } from '@/lib/revenue'
import { usd, percent } from '@/lib/format'
import { METHODS } from '@/lib/payment-methods'
import { RevenueChart } from '@/components/revenue-chart'
import { OccupancyDonut } from '@/components/occupancy-donut'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ingresos' }

/**
 * Lo que el negocio ha generado.
 *
 * El resumen del panel enseña cifras sueltas —pagos por verificar, reservas
 * pendientes— y ninguna serie. Aquí está la pregunta que faltaba: cuánto entró
 * este mes, comparado con los anteriores, y por dónde entró.
 *
 * ## Ingreso no es «lo que pasó por la cuenta»
 *
 * Hay cuatro cosas distintas y confundirlas produce un número que miente:
 *
 * - **Cobrado** — todo lo que entró.
 * - **Devuelto** — lo que salió por reembolsos.
 * - **Impuestos** — se recaudan por cuenta del fisco. No son del negocio.
 * - **IGTF** — tampoco, y ya vive fuera de `amount_usd` desde la `0024`.
 *
 * El ingreso real es cobrado menos devuelto menos impuestos. Es la resta que
 * hace `revenue_by_month()`, en la base y no aquí.
 */
export default async function RevenuePage() {
  const { months, byMethod, occupancy, vatEnabled } = await getRevenueSummary()

  const current = months[months.length - 1]
  const previous = months[months.length - 2]

  // Fracción, no porcentaje: percent() se encarga de multiplicar y de darle el
  // formato de la interfaz. Solo el signo positivo va a mano, porque Intl no lo
  // pone y aquí dice si el mes fue mejor o peor.
  const change =
    previous && previous.net > 0
      ? (current.net - previous.net) / previous.net
      : null

  const methodTotal = byMethod.reduce((sum, m) => sum + m.amount, 0)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Ingresos</h1>
      <p className="mt-1 text-descripcion text-ink/70">
        Lo que se quedó el negocio, ya descontadas las devoluciones y lo que se
        recauda para el fisco.
      </p>

      <section className="mt-6 rounded-2xl border border-ink/10 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Ingreso por mes</h2>
          {change !== null && (
            <p className="text-xs text-ink/70">
              {change >= 0 ? '+' : ''}
              {percent(change)} respecto al mes anterior
            </p>
          )}
        </div>

        <div className="mt-4">
          <RevenueChart months={months} />
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Ocupación de este mes</h2>
          <div className="mt-4">
            <OccupancyDonut occupancy={occupancy} />
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Por dónde entró</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            Cobros aprobados de este mes.
          </p>

          {byMethod.length > 0 ? (
            /*
              Barras horizontales, no un donut: con seis canales de pago,
              comparar arcos es adivinar. Aquí la etiqueta cabe al lado y la
              longitud se lee sin esfuerzo.
            */
            <ul className="mt-4 space-y-3">
              {byMethod.map((m) => (
                <li key={m.method}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{METHODS[m.method]?.label ?? m.method}</span>
                    <span className="tabular-nums text-ink/70">{usd(m.amount)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-ink/8">
                    <div
                      className="h-full rounded-full bg-clay"
                      style={{
                        width: `${methodTotal > 0 ? (m.amount / methodTotal) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink/70">
              Sin cobros aprobados este mes.
            </p>
          )}
        </section>
      </div>

      {/*
        El IGTF y los impuestos se enseñan juntos y aparte del ingreso, porque
        son la otra pregunta: no «cuánto gané» sino «cuánto tengo que enterar».
      */}
      {(current.igtf > 0 || current.tax > 0) && (
        <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-6">
          <h2 className="text-base font-semibold">Recaudado para el fisco</h2>
          <p className="mt-1 text-descripcion text-ink/70">
            No es ingreso. Se cobra al huésped y se entera.
          </p>

          <dl className="mt-4 flex flex-wrap gap-8">
            {current.tax > 0 && (
              <div>
                <dt className="text-xs text-ink/70">Impuestos este mes</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                  {usd(current.tax)}
                </dd>
              </div>
            )}
            {current.igtf > 0 && (
              <div>
                <dt className="text-xs text-ink/70">IGTF este mes</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                  {usd(current.igtf)}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {!vatEnabled && (
        <p className="mt-5 text-xs text-ink/60">
          El IVA está apagado en Ajustes, así que aquí no se descuenta ningún
          impuesto: todo lo cobrado cuenta como ingreso. Al encenderlo, lo
          recaudado saldrá restado y con su propia cifra.
        </p>
      )}
    </main>
  )
}
