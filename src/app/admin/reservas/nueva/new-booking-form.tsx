'use client'

import { useActionState, useState } from 'react'
import { createBookingAsStaff, type NewBookingState } from './actions'
import { DocumentInput } from '@/components/document-input'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function NewBookingForm({
  units,
}: {
  units: { id: string; name: string; max_guests: number; base_price_usd: number }[]
}) {
  const [state, action, pending] = useActionState<NewBookingState, FormData>(
    createBookingAsStaff,
    {},
  )
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [notify, setNotify] = useState(true)

  const unit = units.find((u) => u.id === unitId)

  // Basta con que parezca un correo: la validación de verdad la hace el
  // servidor, aquí solo se decide si tiene sentido ofrecer el envío.
  const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  function changeFrom(value: string) {
    setFrom(value)
    if (value && (!to || to <= value)) setTo(addDays(value, 1))
  }

  return (
    <form action={action} className="space-y-8">
      <section>
        <h2 className="text-base font-semibold">Estadía</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">Unidad</span>
            <select
              name="unitId"
              required
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={field}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Entrada</span>
            <input
              name="checkIn"
              type="date"
              required
              value={from}
              onChange={(e) => changeFrom(e.target.value)}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Salida</span>
            <input
              name="checkOut"
              type="date"
              required
              value={to}
              min={from ? addDays(from, 1) : undefined}
              onChange={(e) => setTo(e.target.value)}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Huéspedes</span>
            <select name="guests" defaultValue={2} className={field}>
              {Array.from({ length: unit?.max_guests ?? 6 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Descuento (USD)</span>
            <input
              name="discount"
              type="number"
              min={0}
              step="0.01"
              defaultValue={0}
              className={field}
            />
            <span className="mt-1 block text-xs text-ink/60">
              Se resta del total calculado.
            </span>
          </label>
        </div>

        <p className="mt-3 text-xs text-ink/60">
          El precio lo calcula el servidor con las tarifas y temporadas de la unidad. Como
          operador puedes cerrar para hoy mismo y saltarte el mínimo de noches, pero no la
          disponibilidad: si las fechas están ocupadas, no se crea.
        </p>
      </section>

      <section className="border-t border-ink/10 pt-8">
        <h2 className="text-base font-semibold">Huésped</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">Nombre completo</span>
            <input name="name" required className={field} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Correo <span className="text-ink/60">(opcional)</span>
            </span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Teléfono / WhatsApp</span>
            <input name="phone" type="tel" className={field} />
          </label>

          <DocumentInput name="document" label="Cédula o pasaporte" />

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">Nota interna</span>
            <textarea name="notes" rows={2} className={field} />
          </label>
        </div>

        <p className="mt-3 text-xs text-ink/60">
          Basta con el correo o el teléfono. Por WhatsApp lo normal es tener solo el
          teléfono, y no conviene inventar un correo: rebota y daña la reputación de envío
          del dominio.
        </p>
      </section>

      {/*
        Sin correo no se muestra la casilla en absoluto.
        Una casilla marcada y en gris dice «esto va a pasar y no puedes
        evitarlo», cuando ocurre justo lo contrario. Y `defaultChecked` solo
        aplica al montar: al escribir un correo después, el control se quedaba
        con el estado inicial.
      */}
      <section className="border-t border-ink/10 pt-8">
        {hasEmail ? (
          <label className="flex items-start gap-3 text-sm">
            <input
              name="notify"
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Enviarle el correo con su enlace
              <span className="mt-0.5 block text-xs text-ink/60">
                Si ya quedaste con el huésped por WhatsApp, puedes ahorrártelo.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-ink/70">
            <strong className="font-medium text-ink">Sin correo no hay aviso.</strong>{' '}
            Al crearla te daremos el enlace para compartirlo por WhatsApp desde la ficha.
          </p>
        )}
      </section>

      {state.error && (
        <p role="alert" className="rounded-xl bg-clay/15 px-4 py-3 text-sm text-ink/80">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-4 border-t border-ink/10 pt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-ink px-6 py-3 text-sm text-sand transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? 'Creando…' : 'Crear reserva'}
        </button>
        <span className="text-sm text-ink/70">
          Queda pendiente. El cobro se registra en la ficha.
        </span>
      </div>
    </form>
  )
}
