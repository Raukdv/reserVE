'use client'

import { useActionState, useRef, useState } from 'react'
import { reportPayment, type ReportState } from '@/app/reserva/[code]/actions'
import { METHODS, GUEST_METHODS } from '@/lib/payment-methods'
import type { PaymentMethod } from '@/types/database'

const MAX_EDGE = 1280
const WEBP_QUALITY = 0.7

/**
 * Redimensiona y convierte a WebP antes de subir.
 *
 * Una captura de pago móvil pesa entre 0,5 y 2 MB; así queda en 80–150 KB. Sin
 * esto, el gigabyte de Storage del plan gratuito se agota en unos mil
 * comprobantes. Ver docs/COSTO-CERO.md, regla 3.6.
 *
 * Si algo falla —formato raro, canvas bloqueado— se devuelve el original y deja
 * que el servidor decida: es preferible un rechazo claro por tamaño a perder el
 * comprobante.
 */
async function compress(file: File): Promise<File> {
  if (file.type === 'application/pdf') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    )
    if (!blob) return file

    return new File([blob], 'comprobante.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`

export function PaymentReportForm({
  code,
  suggestedUsd,
  rate,
}: {
  code: string
  /** Anticipo pendiente, en USD. Se usa para prellenar el monto. */
  suggestedUsd: number
  rate: number
}) {
  const [state, dispatch, pending] = useActionState<ReportState, FormData>(reportPayment, {})
  const [method, setMethod] = useState<PaymentMethod>('pago_movil')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [original, setOriginal] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const spec = METHODS[method]
  const suggested =
    spec.currency === 'USD' ? suggestedUsd : Math.round(suggestedUsd * rate * 100) / 100

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      setReceipt(null)
      setOriginal(null)
      return
    }
    setWorking(true)
    setOriginal(file.size)
    setReceipt(await compress(file))
    setWorking(false)
  }

  // El archivo comprimido reemplaza al del input, que sigue teniendo el original.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (receipt) data.set('receipt', receipt)
    dispatch(data)
  }

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-moss/40 bg-moss/5 p-6">
        <p className="font-medium text-moss">{state.ok}</p>
        <p className="mt-2 text-sm text-ink/60">
          Verificamos los pagos manualmente, normalmente el mismo día.
        </p>
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="code" value={code} />

      <label className="block">
        <span className="mb-1 block text-sm text-ink/60">¿Por dónde pagaste?</span>
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
          <span className="mb-1 block text-sm text-ink/60">
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
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink/60">Fecha y hora del pago</span>
          <input name="paidAt" type="datetime-local" required className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink/60">{spec.originLabel}</span>
          <input name="origin" placeholder={spec.originPlaceholder} className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink/60">{spec.referenceLabel}</span>
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
              <span className="mb-1 block text-sm text-ink/60">Titular que paga</span>
              <input name="payerName" className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink/60">Cédula del titular</span>
              <input name="payerDocument" placeholder="V-12345678" className={field} />
            </label>
          </>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-sm text-ink/60">Captura del pago</span>
        <input
          name="receipt"
          type="file"
          accept="image/*,application/pdf"
          required
          onChange={onPick}
          className="w-full rounded-xl border border-dashed border-ink/25 bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink/8 file:px-3 file:py-1.5 file:text-sm"
        />
        {working && <span className="mt-1 block text-xs text-ink/45">Optimizando…</span>}
        {receipt && original !== null && !working && (
          <span className="mt-1 block text-xs text-ink/45">
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
        disabled={pending || working}
        className="w-full rounded-xl bg-ink px-6 py-3.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? 'Enviando…' : 'Reportar pago'}
      </button>
    </form>
  )
}
