'use client'

import { useActionState, useState } from 'react'
import {
  recordPayment,
  confirmWithoutPayment,
  cancelBooking,
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

export function BookingActions({
  code,
  status,
  outstandingUsd,
  rate,
}: {
  code: string
  status: string
  /** Lo que falta para cubrir el anticipo, en USD. */
  outstandingUsd: number
  rate: number
}) {
  const open = status === 'pending' || status === 'confirmed' || status === 'checked_in'
  if (!open) return null

  return (
    <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-sm font-medium">Acciones</h2>

      <div className="mt-5 space-y-5">
        {/* La estadía manda: si el huésped está llegando o saliendo, eso es lo
            primero que el operador necesita a mano. */}
        {status === 'confirmed' && <StayStep code={code} step="in" />}
        {status === 'checked_in' && <StayStep code={code} step="out" />}

        <RecordPayment code={code} suggested={outstandingUsd} rate={rate} />
        {status === 'pending' && <ConfirmWithoutPayment code={code} />}
        <Cancel code={code} />
      </div>
    </section>
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

      <p className="mt-2 text-xs text-ink/50">
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
      <p className="mt-2 text-xs text-ink/50">
        Para dinero que entró fuera de la app: efectivo, una transferencia que ya viste en
        tu cuenta, o una reserva cerrada por teléfono.
      </p>

      {open && (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="code" value={code} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/50">Canal</span>
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
              <span className="mb-1 block text-xs text-ink/50">
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
              <span className="mb-1 block text-xs text-ink/50">Referencia</span>
              <input name="reference" className={field} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-ink/50">Nota interna</span>
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
        className="text-sm text-ink/60 underline hover:text-ink"
      >
        {open ? 'Cerrar' : 'Confirmar sin cobro'}
      </button>
      <p className="mt-2 text-xs text-ink/50">
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

function Cancel({ code }: { code: string }) {
  const [state, action, pending] = useActionState<BookingActionState, FormData>(
    cancelBooking,
    {},
  )
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-ink/10 pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink/45 underline hover:text-red-700"
      >
        {open ? 'Cerrar' : 'Cancelar reserva'}
      </button>
      <p className="mt-2 text-xs text-ink/50">
        Libera las fechas. La reserva y sus pagos se conservan con el motivo.
      </p>

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
