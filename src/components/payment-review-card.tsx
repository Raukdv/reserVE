'use client'

import { useActionState, useState } from 'react'
import { approvePayment, rejectPayment, type ReviewState } from '@/app/admin/pagos/actions'
import type { PaymentMethod } from '@/types/database'

const METHOD_LABEL: Record<PaymentMethod, string> = {
  pago_movil: 'Pago Móvil',
  c2p: 'C2P',
  transferencia: 'Transferencia',
  zelle: 'Zelle',
  binance: 'Binance',
  paypal: 'PayPal',
  usdt: 'USDT',
  tarjeta: 'Tarjeta',
  efectivo: 'Efectivo',
}

// Qué hay que mirar en el comprobante según por dónde dice haber pagado.
const VERIFY_HINT: Partial<Record<PaymentMethod, string>> = {
  zelle: 'Confirma el correo del remitente y el ID en tu cuenta Zelle.',
  binance: 'Confirma el ID de orden en el historial de Binance Pay.',
  paypal: 'Confirma el ID de transacción en PayPal.',
  pago_movil: 'Confirma la referencia y el monto exacto en el estado de cuenta.',
  transferencia: 'Confirma la referencia contra el movimiento bancario.',
  usdt: 'Confirma el hash de la transacción en el explorador de la red.',
}

export type ReviewPayment = {
  id: string
  method: PaymentMethod
  currency: 'USD' | 'VES'
  amount: number
  /** Lo que abona a la reserva: el bruto menos el IGTF. */
  amount_usd: number
  /** Parte del bruto que es impuesto. Cero si no se recauda IGTF. */
  igtf_usd: number
  origin: string | null
  reference: string | null
  paid_at: string | null
  payer_name: string | null
  payer_document: string | null
  receiptUrl: string | null
  createdAt: string
  booking: {
    code: string
    guestName: string
    guestEmail: string
    unitName: string
    checkIn: string
    checkOut: string
    totalUsd: number
    depositRatio: number
    status: string
  } | null
}

const money = (value: number, currency: 'USD' | 'VES') =>
  new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(value)

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : '—'

export function PaymentReviewCard({ payment }: { payment: ReviewPayment }) {
  const [approveState, approve, approving] = useActionState<ReviewState, FormData>(
    approvePayment,
    {},
  )
  const [rejectState, reject, rejecting] = useActionState<ReviewState, FormData>(
    rejectPayment,
    {},
  )
  const [showReject, setShowReject] = useState(false)

  const state = approveState.error || approveState.ok ? approveState : rejectState
  const booking = payment.booking

  // El monto declarado se contrasta contra el anticipo exigido: es la
  // comprobación que realmente decide si la reserva puede confirmarse.
  const required = booking ? booking.totalUsd * booking.depositRatio : null
  const shortfall = required !== null ? required - payment.amount_usd : null
  const mismatch = shortfall !== null && shortfall > 0.01

  return (
    <article className="grid gap-6 rounded-2xl border border-ink/10 bg-white p-6 lg:grid-cols-[1fr_260px]">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-ink/8 px-3 py-1 text-xs font-medium">
            {METHOD_LABEL[payment.method]}
          </span>
          {booking && (
            <span className="text-sm text-ink/70">
              Reserva <strong className="font-medium text-ink">{booking.code}</strong>
            </span>
          )}
          <span className="text-xs text-ink/60">reportado {when(payment.createdAt)}</span>
        </div>

        <p className="mt-4 text-2xl font-semibold">
          {money(payment.amount, payment.currency)}
          {payment.currency !== 'USD' && (
            <span className="ml-2 text-base font-normal text-ink/70">
              ≈ {money(payment.amount_usd + payment.igtf_usd, 'USD')}
            </span>
          )}
        </p>

        {/*
          Con IGTF, el importe grande es lo que se movió y no lo que abona la
          reserva. Contrastar el comprobante contra la cifra equivocada es
          rechazar un pago correcto, así que se desglosa.
        */}
        {payment.igtf_usd > 0 && (
          <p className="mt-1 text-sm text-ink/70">
            {money(payment.amount_usd, 'USD')} para la reserva ·{' '}
            {money(payment.igtf_usd, 'USD')} de IGTF, que se entera al SENIAT
          </p>
        )}

        {required !== null && (
          <p className={`mt-1 text-sm ${mismatch ? 'text-amber-700' : 'text-ink/70'}`}>
            Anticipo requerido {money(required, 'USD')}
            {mismatch && ` · faltan ${money(shortfall!, 'USD')}`}
          </p>
        )}

        <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Origen" value={payment.origin} />
          <Field label="Referencia / ID" value={payment.reference} mono />
          <Field label="Pagado el" value={when(payment.paid_at)} />
          <Field label="Titular" value={payment.payer_name} />
          <Field label="Documento" value={payment.payer_document} />
          {booking && (
            <>
              <Field label="Huésped" value={`${booking.guestName} · ${booking.guestEmail}`} />
              <Field label="Unidad" value={booking.unitName} />
              <Field label="Estadía" value={`${booking.checkIn} → ${booking.checkOut}`} />
            </>
          )}
        </dl>

        {VERIFY_HINT[payment.method] && (
          <p className="mt-5 rounded-xl bg-sand p-3 text-xs text-ink/70">
            {VERIFY_HINT[payment.method]}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <form action={approve}>
            <input type="hidden" name="paymentId" value={payment.id} />
            <button
              disabled={approving || rejecting}
              className="rounded-xl bg-moss px-5 py-2.5 text-sm text-white transition hover:bg-moss/85 disabled:opacity-50"
            >
              {approving ? 'Aprobando…' : 'Aprobar'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setShowReject((v) => !v)}
            disabled={approving || rejecting}
            className="rounded-xl border border-ink/15 px-5 py-2.5 text-sm transition hover:border-ink/40 disabled:opacity-50"
          >
            Rechazar
          </button>

          {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
          {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        </div>

        {showReject && (
          <form action={reject} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="paymentId" value={payment.id} />
            <input
              name="reason"
              placeholder="Motivo (lo verá el huésped)"
              className="min-w-64 flex-1 rounded-xl border border-ink/15 px-3 py-2 text-sm"
            />
            <button
              disabled={rejecting}
              className="rounded-xl bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
            >
              {rejecting ? 'Rechazando…' : 'Confirmar rechazo'}
            </button>
          </form>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs text-ink/70">Comprobante</p>
        {payment.receiptUrl ? (
          <a href={payment.receiptUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={payment.receiptUrl}
              alt="Comprobante de pago"
              className="w-full rounded-xl border border-ink/10 object-cover"
            />
          </a>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-ink/20 text-xs text-ink/60">
            Sin captura adjunta
          </div>
        )}
      </div>
    </article>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-ink/60">{label}</dt>
      <dd className={`mt-0.5 break-words ${mono ? 'font-mono text-[13px]' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}
