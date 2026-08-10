'use client'

import { useActionState } from 'react'
import { createBooking, type BookingState } from './actions'
import { DocumentInput } from '@/components/document-input'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

export function BookingForm({
  unitId,
  checkIn,
  checkOut,
  guests,
}: {
  unitId: string
  checkIn: string
  checkOut: string
  guests: number
}) {
  const [state, action, pending] = useActionState<BookingState, FormData>(createBooking, {})

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="checkIn" value={checkIn} />
      <input type="hidden" name="checkOut" value={checkOut} />
      <input type="hidden" name="guests" value={guests} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-ink/60">Nombre completo</span>
          <input name="name" required autoComplete="name" className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink/60">Correo</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={field}
          />
          <span className="mt-1 block text-xs text-ink/45">
            Ahí te llega el enlace para gestionar la reserva.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink/60">Teléfono / WhatsApp</span>
          <input name="phone" type="tel" autoComplete="tel" className={field} />
        </label>

        <DocumentInput name="document" label="Cédula o pasaporte" />

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-ink/60">
            Comentarios <span className="text-ink/40">(opcional)</span>
          </span>
          <textarea name="notes" rows={3} className={field} />
        </label>
      </div>

      {state.error && (
        <p role="alert" className="rounded-xl bg-clay/15 px-4 py-3 text-sm text-ink/80">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-ink px-6 py-3.5 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? 'Reservando…' : 'Reservar y ver cómo pagar'}
      </button>

      <p className="text-center text-xs text-ink/45">
        Las fechas quedan retenidas a tu nombre. Todavía no se cobra nada.
      </p>
    </form>
  )
}
