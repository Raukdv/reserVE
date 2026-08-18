'use client'

import { useActionState } from 'react'
import { startCardCheckout, type ReportState } from '@/app/reserva/[code]/actions'

/**
 * Salida al checkout alojado de Stripe.
 *
 * El importe no se envía desde aquí: lo calcula el servidor a partir de la
 * reserva. Este formulario solo lleva el código.
 */
export function CardCheckoutButton({
  code,
  amountLabel,
  testMode,
}: {
  code: string
  amountLabel: string
  testMode: boolean
}) {
  const [state, action, pending] = useActionState<ReportState, FormData>(
    startCardCheckout,
    {},
  )

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-medium">Pagar con tarjeta</p>
          <p className="mt-1 text-descripcion text-ink/70">
            Visa, Mastercard o American Express internacionales. Se cobra en dólares y la
            reserva se confirma sola.
          </p>
        </div>

        <form action={action}>
          <input type="hidden" name="code" value={code} />
          <button
            disabled={pending}
            className="rounded-xl bg-ink px-6 py-3 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
          >
            {pending ? 'Abriendo…' : `Pagar ${amountLabel}`}
          </button>
        </form>
      </div>

      {testMode && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong className="font-medium">Modo de prueba.</strong> No se cobra dinero real.
          Usa la tarjeta <span className="font-mono">4242 4242 4242 4242</span>, cualquier
          fecha futura y cualquier CVC.
        </p>
      )}

      {state.error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <p className="mt-4 text-xs text-ink/60">
        El pago se procesa en Stripe. Los datos de tu tarjeta no pasan por este sitio.
      </p>
    </div>
  )
}
