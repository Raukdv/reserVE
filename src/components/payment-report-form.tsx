'use client'

import { useActionState, useState, useTransition } from 'react'
import { reportPayment, type ReportState } from '@/app/reserva/[code]/actions'
import { METHODS, GUEST_METHODS } from '@/lib/payment-methods'
import { compressImage, kb } from '@/lib/compress-image'
import { usd } from '@/lib/format'
import { DocumentInput } from '@/components/document-input'
import type { PaymentMethod } from '@/types/database'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

export function PaymentReportForm({
  code,
  suggestedUsd,
  rate,
  igtfRate = 0,
}: {
  code: string
  /** Anticipo pendiente, en USD. Se usa para prellenar el monto. */
  suggestedUsd: number
  rate: number
  /**
   * Alícuota del IGTF, o 0 si el negocio no lo recauda.
   *
   * Solo grava los canales en divisas. Sin esto, el monto sugerido para Zelle
   * se quedaría corto y el pago llegaría por debajo del anticipo: el huésped
   * creería haber pagado y la reserva no se confirmaría.
   */
  igtfRate?: number
}) {
  const [state, dispatch, pending] = useActionState<ReportState, FormData>(reportPayment, {})
  const [submitting, startSubmit] = useTransition()
  const [method, setMethod] = useState<PaymentMethod>('pago_movil')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [original, setOriginal] = useState<number | null>(null)
  const [working, setWorking] = useState(false)

  const spec = METHODS[method]

  // En divisas se pide el importe con el IGTF dentro, que es lo que hay que
  // transferir. En bolívares no aplica.
  const withIgtf = spec.currency === 'USD' ? suggestedUsd * (1 + igtfRate) : suggestedUsd
  const igtfUsd = Math.round((withIgtf - suggestedUsd) * 100) / 100
  const suggested =
    spec.currency === 'USD'
      ? Math.round(withIgtf * 100) / 100
      : Math.round(withIgtf * rate * 100) / 100

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      setReceipt(null)
      setOriginal(null)
      return
    }
    setWorking(true)
    setOriginal(file.size)
    // Un PDF pasa tal cual; compressImage solo actúa sobre imágenes.
    setReceipt(await compressImage(file, { maxEdge: 1280, quality: 0.7 }))
    setWorking(false)
  }

  // El archivo comprimido reemplaza al del input, que sigue teniendo el original.
  //
  // Al construir el FormData a mano hay que despachar dentro de una transición:
  // React lo exige para las acciones de useActionState, y sin ella `pending`
  // nunca se pone a true — el botón no se deshabilita y se puede enviar el mismo
  // comprobante dos veces.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (receipt) data.set('receipt', receipt)
    startSubmit(() => dispatch(data))
  }

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-moss/40 bg-moss/5 p-6">
        <p className="font-medium text-moss">{state.ok}</p>
        <p className="mt-2 text-descripcion text-ink/70">
          Verificamos los pagos manualmente, normalmente el mismo día.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="code" value={code} />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">¿Por dónde pagaste?</span>
        <select
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          className={field}
        >
          {GUEST_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHODS[m].label} · {METHODS[m].currency}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            Monto pagado ({spec.currency})
          </span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={suggested}
            key={method}
            className={field}
          />
          {igtfUsd > 0 && (
            <span className="mt-1 block text-xs text-ink/60">
              Incluye {usd(igtfUsd)} de IGTF ({(igtfRate * 100).toFixed(1).replace('.', ',')} %)
              por pagar en divisas. En bolívares no se aplica.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Fecha y hora del pago</span>
          <input name="paidAt" type="datetime-local" required className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">{spec.originLabel}</span>
          <input name="origin" placeholder={spec.originPlaceholder} className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">{spec.referenceLabel}</span>
          <input
            name="reference"
            required
            placeholder={spec.referencePlaceholder}
            className={field}
          />
        </label>

        {spec.needsPayer && (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Titular que paga</span>
              <input name="payerName" className={field} />
            </label>
            <DocumentInput name="payerDocument" label="Documento del titular" />
          </>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Captura del pago</span>
        <input
          name="receipt"
          type="file"
          accept="image/*,application/pdf"
          required
          onChange={onPick}
          className="w-full rounded-xl border border-dashed border-ink/25 bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink/8 file:px-3 file:py-1.5 file:text-sm"
        />
        {working && <span className="mt-1 block text-xs text-ink/60">Optimizando…</span>}
        {receipt && original !== null && !working && (
          <span className="mt-1 block text-xs text-ink/60">
            {original === receipt.size
              ? kb(receipt.size)
              : `${kb(original)} → ${kb(receipt.size)} tras optimizar`}
          </span>
        )}
      </label>

      {state.error && (
        <p role="alert" className="rounded-xl bg-clay/15 px-4 py-3 text-sm text-ink/80">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || submitting || working}
        className="w-full rounded-xl bg-ink px-6 py-3.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending || submitting ? 'Enviando…' : 'Reportar pago'}
      </button>
    </form>
  )
}
