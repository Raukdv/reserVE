import {
  activeStepIndex,
  cancellationSteps,
  deadlineLabel,
  tierDetail,
  tierTitle,
  type CancellationTier,
} from '@/lib/cancellation'
import { usd } from '@/lib/format'

/**
 * Escalera de cancelación con las fechas reales de una reserva.
 *
 * La versión genérica —«hasta 7 días antes»— obliga al huésped a hacer la cuenta
 * sobre sus propias fechas. Mostrando el instante límite ya calculado, la
 * pregunta «¿hasta cuándo puedo cancelar?» se responde sin pensar.
 */
export type RefundQuote = {
  paid_usd: number
  entitlement_usd: number
  refund_usd: number
  kind: 'percent' | 'nights' | 'none'
}

export function CancellationSchedule({
  tiers,
  checkIn,
  checkInTime,
  quote,
  notes,
}: {
  tiers: CancellationTier[]
  checkIn: string
  checkInTime: string
  /** Cálculo del servidor para esta reserva. Sin él solo se muestran los plazos. */
  quote?: RefundQuote
  notes?: string | null
}) {
  const steps = cancellationSteps(tiers, checkIn, checkInTime)
  if (steps.length === 0) return null

  const now = new Date()
  const active = activeStepIndex(steps, now)

  return (
    <div>
      <ol className="divide-y divide-ink/10 border-y border-ink/10">
        {steps.map((step, i) => {
          const past = now > step.deadline

          return (
            <li
              key={i}
              className={`grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6 ${
                past ? 'opacity-40' : ''
              }`}
            >
              <div className="text-sm">
                <span className="block text-ink/70">Antes del</span>
                <span className={i === active ? 'font-medium' : ''}>
                  {deadlineLabel(step.deadline)}
                </span>
              </div>

              <div className="text-sm">
                <span className={`block ${i === active ? 'font-medium' : ''}`}>
                  {tierTitle(step.tier)}
                </span>
                <span className="text-ink/70">{tierDetail(step.tier)}</span>
              </div>
            </li>
          )
        })}

        <li
          className={`grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6 ${
            active === -1 ? '' : 'opacity-40'
          }`}
        >
          <div className="text-sm">
            <span className="block text-ink/70">Después</span>
            <span className={active === -1 ? 'font-medium' : ''}>de ese plazo</span>
          </div>
          <div className="text-sm">
            <span className={`block ${active === -1 ? 'font-medium' : ''}`}>
              Sin reembolso
            </span>
            <span className="text-ink/70">No se devuelve nada de lo pagado.</span>
          </div>
        </li>
      </ol>

      <p className="mt-4 text-xs text-ink/60">
        Las horas son las de Venezuela, medidas desde tu hora de entrada.
      </p>

      {quote && (
        <div className="mt-4 rounded-xl bg-sand p-4 text-sm">
          <p>
            Si cancelas ahora:{' '}
            <strong className="font-medium">
              {quote.refund_usd > 0 ? usd(quote.refund_usd) : 'sin reembolso'}
            </strong>
            {quote.paid_usd > 0 && <> de {usd(quote.paid_usd)} pagados</>}.
          </p>

          {/*
            Cuando lo que corresponde supera lo cobrado, conviene decirlo: el
            huésped podría esperar la cifra mayor que vio en la escalera.
          */}
          {quote.entitlement_usd > quote.refund_usd && (
            <p className="mt-2 text-xs text-ink/70">
              La política cubre {usd(quote.entitlement_usd)}, pero solo se devuelve lo que
              llegaste a pagar.
            </p>
          )}
        </div>
      )}

      {notes && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">
          {notes}
        </p>
      )}
    </div>
  )
}
