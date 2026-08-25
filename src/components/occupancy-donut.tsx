import type { Occupancy } from '@/lib/revenue'

/**
 * Ocupación del mes: dos segmentos y el porcentaje al centro.
 *
 * Es parte de un todo y son **dos** valores, que es justo donde el donut gana y
 * la barra no aporta. Con tres o más categorías la comparación de arcos empieza
 * a ser adivinanza, y entonces tocaría barra.
 *
 * El segundo segmento no lleva color propio: lo vendido tiene identidad, lo
 * libre es «el resto» y va en neutro. Dos colores harían pensar que son dos
 * cosas comparables.
 *
 * Un `<circle>` con `stroke-dasharray` y nada más. Sin librería.
 */
export function OccupancyDonut({ occupancy }: { occupancy: Occupancy }) {
  const { sold, available, ratio } = occupancy

  // Radio elegido para que la circunferencia sea ~100: así el dasharray se
  // escribe en porcentaje directamente y no hay que multiplicar por 2πr.
  const R = 15.915
  const pct = Math.round(ratio * 100)

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0 -rotate-90" role="img"
        aria-label={`Ocupación del mes: ${pct} %, ${sold} de ${available} noches`}>
        <circle
          cx="21" cy="21" r={R} fill="none"
          className="stroke-ink/10" strokeWidth="4"
        />
        {sold > 0 && (
          <circle
            cx="21" cy="21" r={R} fill="none"
            className="stroke-clay" strokeWidth="4" strokeLinecap="round"
            // El hueco de 0,5 evita que los extremos redondeados se pisen
            // cuando la ocupación se acerca al 100 %.
            strokeDasharray={`${Math.max(ratio * 100 - 0.5, 0.5)} ${100 - ratio * 100}`}
          />
        )}
      </svg>

      <div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{pct} %</p>
        <p className="mt-0.5 text-descripcion text-ink/70">
          {sold} de {available} noche{available === 1 ? '' : 's'} vendidas
        </p>
        <p className="mt-2 text-xs text-ink/60">
          Solo estadías. Una unidad bloqueada por mantenimiento no cuenta como
          vendida.
        </p>
      </div>
    </div>
  )
}
