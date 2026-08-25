'use client'

import { useState } from 'react'
import { usd } from '@/lib/format'
import type { RevenueMonth } from '@/lib/revenue'

/**
 * Ingreso por mes, en barras.
 *
 * ## Por qué barras y por qué una sola serie
 *
 * Comparar doce valores es lo que peor hace un donut y lo que mejor hace una
 * barra. Y la barra dice **una** cosa: lo que se quedó el negocio. Los impuestos
 * recaudados son otra pregunta —cuánto hay que enterar— y van en su propia cifra
 * al lado. Apilarlos aquí haría que ninguna de las dos se respondiera bien.
 *
 * Con una sola serie no hace falta leyenda: el título nombra lo que se ve.
 *
 * ## Por qué sin librería de gráficos
 *
 * Doce rectángulos son doce divs. Meter una librería de charts por esto es pagar
 * decenas de kilobytes por algo que solo mira el operador. Ver `DISENO.md`.
 *
 * ## Accesible sin el ratón
 *
 * Cada barra es un `<button>`: se alcanza tabulando y el detalle sale igual al
 * enfocar que al pasar por encima. Debajo hay una tabla con los mismos números,
 * que es lo que lee un lector de pantalla — un gráfico sin tabla obliga a
 * confiar en el `aria-label`, y un `aria-label` con seis cifras no se escucha.
 */
export function RevenueChart({ months }: { months: RevenueMonth[] }) {
  const [active, setActive] = useState<number | null>(null)

  const max = Math.max(...months.map((m) => m.net), 0)
  const current = months.length - 1
  const shown = active ?? current
  const detail = months[shown]

  const label = (iso: string, long = false) =>
    new Intl.DateTimeFormat('es-VE', {
      month: long ? 'long' : 'short',
      year: long ? 'numeric' : '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`))

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-descripcion text-ink/70">
            {shown === current ? 'Este mes' : label(detail.month, true)}
          </p>
          <p
            className={`mt-0.5 text-3xl font-semibold tracking-tight tabular-nums ${
              detail.net < 0 ? 'text-red-700' : ''
            }`}
          >
            {usd(detail.net)}
          </p>
          {detail.net < 0 && (
            <p className="mt-0.5 text-xs text-red-700">
              Se devolvió más de lo que entró.
            </p>
          )}
        </div>

        {detail.charged > 0 && (
          <dl className="text-right text-xs text-ink/70">
            <div className="flex justify-end gap-2">
              <dt>Cobrado</dt>
              <dd className="tabular-nums text-ink">{usd(detail.charged)}</dd>
            </div>
            {detail.refunded > 0 && (
              <div className="mt-0.5 flex justify-end gap-2">
                <dt>Devuelto</dt>
                <dd className="tabular-nums text-ink">−{usd(detail.refunded)}</dd>
              </div>
            )}
            {detail.tax > 0 && (
              <div className="mt-0.5 flex justify-end gap-2">
                <dt>Impuestos</dt>
                <dd className="tabular-nums text-ink">−{usd(detail.tax)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/*
        `items-end` y una altura fija: las barras crecen desde la línea de base,
        que es lo que permite comparar alturas de un vistazo. Sin base común, un
        gráfico de barras no dice nada.
      */}
      <div
        className="mt-5 flex h-40 items-end gap-1"
        onMouseLeave={() => setActive(null)}
      >
        {months.map((m, i) => {
          // Mínimo visible para que un mes sin ingresos siga teniendo dónde
          // hacer clic. Un 0 sin altura es un hueco que el ratón no encuentra.
          const height = max > 0 ? Math.max((m.net / max) * 100, 1.5) : 1.5
          const selected = i === shown

          /*
            Un mes puede salir en negativo: basta una devolución registrada en
            un mes en el que no entró nada. Dibujarlo como una barra mínima lo
            haría indistinguible de un mes tranquilo, que es justo lo contrario
            de lo que pasó. Se marca en rojo y se dice en el `aria-label`; el
            número con su signo está arriba y en la tabla.
          */
          const loss = m.net < 0

          const fill = loss
            ? selected ? 'bg-red-700' : 'bg-red-700/40 group-hover:bg-red-700/60'
            : selected ? 'bg-clay' : 'bg-clay/35 group-hover:bg-clay/60'

          return (
            <button
              key={m.month}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={
                `${label(m.month, true)}: ${usd(m.net)}` +
                (loss ? ' — se devolvió más de lo que entró' : '')
              }
              aria-pressed={selected}
              className="group flex h-full flex-1 flex-col justify-end outline-none"
            >
              <span
                style={{ height: `${height}%` }}
                className={`w-full rounded-t transition-colors ${fill} group-focus-visible:ring-2 group-focus-visible:ring-ink`}
              />
            </button>
          )
        })}
      </div>

      {/* Eje recesivo: una línea fina, sin rejilla. */}
      <div className="mt-1 border-t border-ink/15" />

      <div className="mt-1.5 flex gap-1 text-[10px] text-ink/60">
        {months.map((m, i) => (
          <span
            key={m.month}
            className={`flex-1 text-center ${i === shown ? 'font-medium text-ink' : ''}`}
          >
            {/* Doce etiquetas no caben: solo se rotula una de cada dos, más la
                que esté seleccionada. */}
            {i % 2 === months.length % 2 || i === shown ? label(m.month) : ''}
          </span>
        ))}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-ink/60">
          Ver los números
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max text-left text-xs">
            <thead className="text-ink/60">
              <tr>
                <th className="py-1 pr-4 font-medium">Mes</th>
                <th className="py-1 pr-4 text-right font-medium">Cobrado</th>
                <th className="py-1 pr-4 text-right font-medium">Devuelto</th>
                <th className="py-1 pr-4 text-right font-medium">Impuestos</th>
                <th className="py-1 pr-4 text-right font-medium">IGTF</th>
                <th className="py-1 text-right font-medium">Ingreso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8">
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="py-1 pr-4">{label(m.month, true)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{usd(m.charged)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{usd(m.refunded)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{usd(m.tax)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{usd(m.igtf)}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{usd(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
