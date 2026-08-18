import { usd, ves } from '@/lib/format'

/**
 * Estado de cobro de una reserva.
 *
 * El anticipo es un **umbral**, no una partida que se resta del total: sirve
 * para decidir si la reserva se confirma, y una vez cubierto deja de importar.
 * Mostrarlo como línea de resta hace que un pago de 80 contra un anticipo de
 * 37,20 no cuadre en ninguna parte.
 *
 * Por eso aquí el total se enfrenta a lo cobrado, y el anticipo aparece como
 * condición cumplida o pendiente, no como cifra que compita con el total.
 *
 * Distingue **cobrado** de **reportado sin verificar**. Son cosas distintas: lo
 * segundo es dinero que alguien dice haber enviado y todavía nadie confirmó.
 */
export type CollectionState = {
  totalUsd: number
  totalVes: number
  depositUsd: number
  depositRatio: number
  /** Suma de pagos aprobados. */
  paidUsd: number
  /** Suma de pagos reportados a la espera de verificación. */
  claimedUsd: number
  approvedCount: number
  claimedCount: number
}

export function collectionState(
  booking: { total_usd: number; total_ves: number; deposit_ratio: number },
  payments: { status: string; amount_usd: number }[],
): CollectionState {
  const sum = (status: string) =>
    payments
      .filter((p) => p.status === status)
      .reduce((acc, p) => acc + Number(p.amount_usd), 0)

  return {
    totalUsd: Number(booking.total_usd),
    totalVes: Number(booking.total_ves),
    depositUsd: Number(booking.total_usd) * Number(booking.deposit_ratio),
    depositRatio: Number(booking.deposit_ratio),
    paidUsd: sum('approved'),
    claimedUsd: sum('verifying'),
    approvedCount: payments.filter((p) => p.status === 'approved').length,
    claimedCount: payments.filter((p) => p.status === 'verifying').length,
  }
}

export function CollectionSummary({
  state,
  showVes = true,
}: {
  state: CollectionState
  showVes?: boolean
}) {
  const { totalUsd, totalVes, depositUsd, depositRatio, paidUsd, claimedUsd } = state

  const remaining = Math.max(0, totalUsd - paidUsd)
  const overpaid = Math.max(0, paidUsd - totalUsd)

  // El mismo centavo de margen que usa settle_booking en la base: absorbe el
  // redondeo al convertir pagos en bolívares.
  const depositMet = paidUsd + 0.01 >= depositUsd

  const pct = (value: number) =>
    totalUsd > 0 ? Math.min(100, (value / totalUsd) * 100) : 0

  return (
    <div>
      <dl className="space-y-2 text-sm">
        <Line label="Total de la reserva" value={usd(totalUsd)} strong />
        {showVes && (
          <Line label="Equivalente en bolívares" value={ves(totalVes)} muted />
        )}

        <div className="border-t border-ink/10 pt-3" />

        <Line
          label={`Cobrado${state.approvedCount ? ` · ${state.approvedCount} pago${state.approvedCount > 1 ? 's' : ''}` : ''}`}
          value={usd(paidUsd)}
          tone={paidUsd > 0 ? 'text-moss' : undefined}
        />

        {claimedUsd > 0 && (
          <Line
            label={`Por verificar · ${state.claimedCount} reporte${state.claimedCount > 1 ? 's' : ''}`}
            value={usd(claimedUsd)}
            tone="text-amber-700"
          />
        )}

        <div className="border-t border-ink/10 pt-3" />

        {overpaid > 0 ? (
          <Line label="Cobrado de más" value={usd(overpaid)} strong tone="text-amber-700" />
        ) : (
          <Line label="Falta por cobrar" value={usd(remaining)} strong />
        )}
      </dl>

      {/* Progreso del cobro, con el umbral del anticipo marcado sobre la barra. */}
      <div className="mt-5">
        <div className="relative h-2 overflow-hidden rounded-full bg-ink/10">
          <div
            className="absolute inset-y-0 left-0 bg-amber-300"
            style={{ width: `${pct(paidUsd + claimedUsd)}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-moss"
            style={{ width: `${pct(paidUsd)}%` }}
          />
          {depositRatio < 1 && (
            <div
              className="absolute inset-y-0 w-px bg-ink/50"
              style={{ left: `${pct(depositUsd)}%` }}
              aria-hidden
            />
          )}
        </div>

        <p className="mt-2.5 text-xs text-ink/70">
          {depositMet ? (
            <>
              Anticipo del {Math.round(depositRatio * 100)}% ({usd(depositUsd)}){' '}
              <span className="text-moss">cubierto</span>
              {remaining > 0 && <> · faltan {usd(remaining)} para el total</>}
            </>
          ) : (
            <>
              Faltan {usd(Math.max(0, depositUsd - paidUsd))} para cubrir el anticipo del{' '}
              {Math.round(depositRatio * 100)}% y poder confirmar
              {claimedUsd > 0 && <> · hay {usd(claimedUsd)} sin verificar</>}
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Line({
  label,
  value,
  strong = false,
  muted = false,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  tone?: string
}) {
  return (
    <div className={`flex justify-between gap-4 ${muted ? 'text-ink/60' : ''}`}>
      <dt className={muted ? '' : 'text-ink/70'}>{label}</dt>
      <dd className={`${strong ? 'font-medium' : ''} ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}
