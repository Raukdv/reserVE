'use client'

import { useActionState, useState } from 'react'
import {
  recordPayment,
  confirmWithoutPayment,
  cancelBooking,
  recordRefund,
  extendStay,
  checkIn,
  checkOut,
  type BookingActionState,
} from '@/app/admin/reservas/[code]/actions'
import { METHODS } from '@/lib/payment-methods'
import type { PaymentMethod } from '@/types/database'

const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40'

// Canales por los que un operador registra dinero que ya recibió. Incluye
// efectivo y tarjeta presencial, que el huésped no puede reportar desde la web.
const STAFF_METHODS: PaymentMethod[] = [
  'efectivo',
  'pago_movil',
  'transferencia',
  'zelle',
  'binance',
  'paypal',
  'usdt',
  'tarjeta',
]

export type RefundPreview = {
  paid_usd: number
  entitlement_usd: number
  refund_usd: number
  kind: 'percent' | 'nights' | 'none'
  refund_percent: number | null
  forfeit_nights: number | null
  forfeited_usd: number | null
  cleaning_refunded: boolean
}

export function BookingActions({
  code,
  status,
  outstandingUsd,
  rate,
  refund,
  refundDueUsd,
  refundedUsd,
  paidUsd,
  checkOutDate,
}: {
  code: string
  status: string
  /** Lo que falta para cubrir el anticipo, en USD. */
  outstandingUsd: number
  rate: number
  /** Qué tocaría devolver si se cancelara ahora, según la política. */
  refund?: RefundPreview | null
  /** Lo que la política obligó a devolver al cancelar. Null si no se canceló. */
  refundDueUsd?: number | null
  /** Lo ya devuelto. */
  refundedUsd?: number
  /** Lo que el huésped llegó a pagar: techo de cualquier devolución. */
  paidUsd?: number
  /** Salida actual, en `YYYY-MM-DD`. Punto de partida para alargar. */
  checkOutDate?: string
}) {
  const open = status === 'pending' || status === 'confirmed' || status === 'checked_in'

  // Una reserva cancelada ya no admite acciones de estadía, pero puede quedar
  // dinero por devolver — y eso hay que poder anotarlo.
  const owes = status === 'cancelled' && (paidUsd ?? 0) > (refundedUsd ?? 0)

  if (!open && !owes) return null

  return (
    <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-base font-semibold">Acciones</h2>

      <div className="mt-5 space-y-5">
        {/* La estadía manda: si el huésped está llegando o saliendo, eso es lo
            primero que el operador necesita a mano. */}
        {status === 'confirmed' && <StayStep code={code} step="in" />}
        {status === 'checked_in' && <StayStep code={code} step="out" />}

        {(status === 'confirmed' || status === 'checked_in') && checkOutDate && (
          <ExtendStay code={code} checkOut={checkOutDate} />
        )}

        {open && <RecordPayment code={code} suggested={outstandingUsd} rate={rate} />}
        {status === 'pending' && <ConfirmWithoutPayment code={code} />}
        {open && <Cancel code={code} refund={refund} />}

        {owes && (
          <RecordRefund
            code={code}
            dueUsd={refundDueUsd ?? null}
            refundedUsd={refundedUsd ?? 0}
            paidUsd={paidUsd ?? 0}
            rate={rate}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Anota una devolución ya hecha.
 *
 * Deliberadamente separada de cancelar. Cancelar genera una deuda; el dinero
 * sale después, puede tardar días, puede ir en varias veces y puede salir por
 * un canal distinto al del cobro. Anotarla al cancelar sería dar por movido un
 * dinero que todavía está en la cuenta.
 */
function RecordRefund({
  code,
  dueUsd,
  refundedUsd,
  paidUsd,
  rate,
}: {
  code: string
  dueUsd: number | null
  refundedUsd: number
  paidUsd: number
  rate: number
}) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    recordRefund,
    {},
  )
  const [currency, setCurrency] = useState<'USD' | 'VES'>('USD')
  const [open, setOpen] = useState(false)

  const money = (value: number) =>
    new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value)

  // Lo que falta por política, acotado por lo que queda en caja: no se puede
  // devolver más de lo que entró aunque la política dijera otra cosa.
  const available = Math.max(0, paidUsd - refundedUsd)
  const pendingUsd = dueUsd === null ? null : Math.max(0, dueUsd - refundedUsd)
  const suggested = Math.min(pendingUsd ?? available, available)

  return (
    <div className="border-t border-ink/10 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Devolución</p>
        {refundedUsd > 0 && (
          <p className="text-xs text-ink/60">Ya devuelto {money(refundedUsd)}</p>
        )}
      </div>

      <p className="mt-1 text-sm text-ink/70">
        {pendingUsd === null ? (
          <>
            Esta reserva no dejó una devolución calculada. Puedes anotar una igual si la
            acordaste aparte; el tope son los {money(available)} que llegó a pagar.
          </>
        ) : pendingUsd > 0 ? (
          <>
            Quedan <strong className="font-medium text-ink">{money(pendingUsd)}</strong> por
            devolver de los {money(dueUsd!)} que marcó la política.
          </>
        ) : (
          <>La devolución está saldada. Puedes anotar otra si acordaste algo más.</>
        )}
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 rounded-lg border border-ink/15 px-4 py-2 text-sm transition hover:border-ink/40"
      >
        {open ? 'Cerrar' : 'Anotar devolución'}
      </button>

      {open && (
        <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="code" value={code} />

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Canal</span>
            <select name="method" className={field} defaultValue="zelle">
              {STAFF_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHODS[m].label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink/60">
              Puede ser distinto al del cobro.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Moneda</span>
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as 'USD' | 'VES')}
              className={field}
            >
              <option value="USD">USD</option>
              <option value="VES">VES</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">
              Monto devuelto ({currency})
            </span>
            <input
              name="amount"
              type="number"
              min={0}
              step="0.01"
              defaultValue={
                currency === 'USD' ? suggested.toFixed(2) : (suggested * rate).toFixed(2)
              }
              className={field}
            />
            {currency === 'VES' && (
              <span className="mt-1 block text-xs text-ink/60">
                Se convierte a la tasa congelada de la reserva, {rate.toLocaleString('es-VE')}.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">
              Referencia <span className="text-ink/60">(opcional)</span>
            </span>
            <input name="reference" className={field} placeholder="ZL-8842019" />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink">
              Nota <span className="text-ink/60">(opcional)</span>
            </span>
            <input
              name="notes"
              className={field}
              placeholder="Lo acordado, si difiere de la política"
            />
          </label>

          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <button
              disabled={pending}
              className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
            >
              {pending ? 'Anotando…' : 'Anotar devolución'}
            </button>
            {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
            {state.error && <span className="text-sm text-red-700">{state.error}</span>}
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Alarga la estadía.
 *
 * Solo hacia adelante: recortar implica devolver dinero y eso pasa por la
 * política de cancelación. Las noches nuevas se cobran a su precio real y los
 * cargos ya pactados no se repactan — lo resuelve `staff_extend_stay()`.
 */
function ExtendStay({ code, checkOut }: { code: string; checkOut: string }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    extendStay,
    {},
  )
  const [open, setOpen] = useState(false)

  // Un día después de la salida actual: es el mínimo que tiene sentido y el
  // valor que se quiere nueve de cada diez veces.
  const nextDay = new Date(`${checkOut}T12:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  const suggested = nextDay.toISOString().slice(0, 10)

  return (
    <div className="border-t border-ink/10 pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm underline hover:text-ink"
      >
        {open ? 'Cerrar' : 'Alargar estadía'}
      </button>
      <p className="mt-2 text-xs text-ink/70">
        El huésped se queda más noches. Se cobran a su precio real y se comprueba que
        las fechas sigan libres.
      </p>

      {open && (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="code" value={code} />

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink">Nueva salida</span>
            <input
              name="checkOut"
              type="date"
              min={suggested}
              defaultValue={suggested}
              required
              className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
            />
          </label>

          <button
            disabled={pending}
            className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
          >
            {pending ? 'Alargando…' : 'Alargar'}
          </button>

          {state.ok && <span className="pb-2 text-sm text-moss">{state.ok}</span>}
          {state.error && <span className="pb-2 text-sm text-red-700">{state.error}</span>}
        </form>
      )}
    </div>
  )
}

/** Entrada y salida. La salida admite cerrar con saldo, marcándolo aparte. */
function StayStep({ code, step }: { code: string; step: 'in' | 'out' }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    step === 'in' ? checkIn : checkOut,
    {},
  )
  const [force, setForce] = useState(false)

  return (
    <div>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="code" value={code} />
        {step === 'out' && force && <input type="hidden" name="force" value="on" />}

        <button
          disabled={pending}
          className="rounded-lg bg-tide px-5 py-2 text-sm text-white transition hover:bg-tide/85 disabled:opacity-50"
        >
          {pending
            ? 'Marcando…'
            : step === 'in'
              ? 'Marcar entrada'
              : 'Marcar salida'}
        </button>

        {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
      </form>

      <p className="mt-2 text-xs text-ink/70">
        {step === 'in'
          ? 'El huésped llegó y la estadía está en curso.'
          : 'Cierra la estadía. Antes comprueba que no quede saldo por cobrar.'}
      </p>

      {state.error && (
        <div className="mt-3">
          <p className="text-sm text-red-700">{state.error}</p>
          {step === 'out' && state.error.includes('sin cobrar') && (
            <label className="mt-2 flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="h-4 w-4"
              />
              Cerrar con saldo pendiente de todos modos
            </label>
          )}
        </div>
      )}
    </div>
  )
}

/** Camino normal: el dinero entró, se anota. */
function RecordPayment({
  code,
  suggested,
  rate,
}: {
  code: string
  suggested: number
  rate: number
}) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    recordPayment,
    {},
  )
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('efectivo')

  const spec = METHODS[method]
  const amount =
    spec.currency === 'USD' ? suggested : Math.round(suggested * rate * 100) / 100

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-moss px-5 py-2 text-sm text-white transition hover:bg-moss/85"
      >
        {open ? 'Cerrar' : 'Registrar cobro recibido'}
      </button>
      <p className="mt-2 text-xs text-ink/70">
        Para dinero que entró fuera de la app: efectivo, una transferencia que ya viste en
        tu cuenta, o una reserva cerrada por teléfono.
      </p>

      {open && (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="code" value={code} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Canal</span>
              <select
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className={field}
              >
                {STAFF_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHODS[m].label} · {METHODS[m].currency}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">
                Monto ({spec.currency})
              </span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                defaultValue={amount}
                key={method}
                className={field}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Referencia</span>
              <input name="reference" className={field} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Nota interna</span>
              <input name="notes" className={field} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={pending}
              className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
            >
              {pending ? 'Registrando…' : 'Registrar'}
            </button>
            {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
            {state.error && <span className="text-sm text-red-700">{state.error}</span>}
          </div>
        </form>
      )}
    </div>
  )
}

/** Excepción: se confirma sin que haya entrado dinero. Exige motivo. */
function ConfirmWithoutPayment({ code }: { code: string }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    confirmWithoutPayment,
    {},
  )
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-ink/10 pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink/70 underline hover:text-ink"
      >
        {open ? 'Cerrar' : 'Confirmar sin cobro'}
      </button>
      <p className="mt-2 text-xs text-ink/70">
        Cortesía, acuerdo especial, o dinero que llegará después. Queda registrado quién lo
        hizo y por qué.
      </p>

      {open && (
        <form action={action} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="code" value={code} />
          <input
            name="reason"
            required
            placeholder="Motivo — obligatorio"
            className={`${field} min-w-64 flex-1`}
          />
          <button
            disabled={pending}
            className="rounded-lg border border-ink/20 px-5 py-2 text-sm transition hover:border-ink/45 disabled:opacity-50"
          >
            {pending ? 'Confirmando…' : 'Confirmar'}
          </button>
          {state.ok && <span className="self-center text-sm text-moss">{state.ok}</span>}
          {state.error && (
            <span className="self-center text-sm text-red-700">{state.error}</span>
          )}
        </form>
      )}
    </div>
  )
}

function Cancel({ code, refund }: { code: string; refund?: RefundPreview | null }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    cancelBooking,
    {},
  )
  const [open, setOpen] = useState(false)

  const money = (value: number) =>
    new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value)

  return (
    <div className="border-t border-ink/10 pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink/60 underline hover:text-red-700"
      >
        {open ? 'Cerrar' : 'Cancelar reserva'}
      </button>
      <p className="mt-2 text-xs text-ink/70">
        Libera las fechas. La reserva y sus pagos se conservan con el motivo.
      </p>

      {/*
        Cuánto habría que devolver, según la política y la fecha de hoy. Sin esto
        el operador cancela a ciegas y tiene que calcularlo a mano justo cuando
        más prisa tiene.
      */}
      {open && refund && refund.paid_usd > 0 && (
        <div className="mt-3 rounded-xl bg-sand p-4 text-sm">
          <p>
            Según la política, corresponde devolver{' '}
            <strong className="font-medium">
              {refund.refund_usd > 0 ? money(refund.refund_usd) : 'nada'}
            </strong>{' '}
            de {money(refund.paid_usd)} cobrados.
          </p>

          <p className="mt-1.5 text-xs text-ink/70">
            {refund.kind === 'nights' && refund.forfeit_nights ? (
              <>
                Retienes {refund.forfeit_nights} noche
                {refund.forfeit_nights === 1 ? '' : 's'}
                {refund.forfeited_usd ? ` (${money(refund.forfeited_usd)})` : ''} más los
                cargos no reembolsables.
              </>
            ) : refund.kind === 'percent' ? (
              <>
                Tramo del {refund.refund_percent} % del alojamiento
                {refund.cleaning_refunded ? ', limpieza incluida' : ', sin la limpieza'}.
              </>
            ) : (
              <>Fuera de todo tramo: la política no obliga a devolver nada.</>
            )}
          </p>

          <p className="mt-2 text-xs text-ink/60">
            El reembolso se hace por fuera de la app, por el mismo canal del cobro. Aquí
            solo se libera la reserva.
          </p>
        </div>
      )}

      {open && (
        <form action={action} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="code" value={code} />
          <input
            name="reason"
            placeholder="Motivo de la cancelación"
            className={`${field} min-w-64 flex-1`}
          />
          <button
            disabled={pending}
            className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
          >
            {pending ? 'Cancelando…' : 'Confirmar cancelación'}
          </button>
          {state.ok && <span className="self-center text-sm text-moss">{state.ok}</span>}
          {state.error && (
            <span className="self-center text-sm text-red-700">{state.error}</span>
          )}
        </form>
      )}
    </div>
  )
}
