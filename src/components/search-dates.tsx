'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

const isoToday = () => new Date().toISOString().slice(0, 10)

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function SearchDates({
  defaults,
  compact = false,
  target = '/alojamientos',
  submitLabel = 'Buscar',
}: {
  defaults?: { from?: string; to?: string; guests?: number }
  compact?: boolean
  /**
   * A dónde lleva el formulario.
   *
   * En la portada y el listado busca entre todas las unidades. Dentro de una
   * ficha apunta a esa misma ficha: quien ya eligió alojamiento no debe acabar
   * de vuelta en el listado por consultar unas fechas.
   */
  target?: string
  submitLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [from, setFrom] = useState(defaults?.from ?? '')
  const [to, setTo] = useState(defaults?.to ?? '')
  const [guests, setGuests] = useState(defaults?.guests ?? 2)

  // La salida siempre debe caer después de la entrada. Al mover la entrada por
  // delante de la salida, se arrastra la salida en lugar de dejar un rango
  // inválido que el servidor tendría que rechazar.
  function changeFrom(value: string) {
    setFrom(value)
    if (value && (!to || to <= value)) setTo(addDays(value, 1))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (from) params.set('desde', from)
    if (to) params.set('hasta', to)
    params.set('huespedes', String(guests))
    // Consultar fechas dentro de la misma ficha no debe saltar al inicio de la
    // página: el cotizador está en la barra lateral y el huésped quiere ver ahí
    // mismo el resultado.
    router.push(`${target}?${params}`, { scroll: target !== pathname })
  }

  const field = 'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm'

  return (
    <form
      onSubmit={submit}
      className={`grid gap-3 rounded-2xl border border-ink/10 bg-white/70 p-3 backdrop-blur sm:grid-cols-[1fr_1fr_auto_auto] ${
        compact ? '' : 'shadow-sm'
      }`}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink">Entrada</span>
        <input
          type="date"
          value={from}
          min={isoToday()}
          onChange={(e) => changeFrom(e.target.value)}
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink">Salida</span>
        <input
          type="date"
          value={to}
          min={from ? addDays(from, 1) : isoToday()}
          onChange={(e) => setTo(e.target.value)}
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink">Huéspedes</span>
        <select
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          className={`${field} sm:w-24`}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="self-end rounded-xl bg-ink px-6 py-2.5 text-sm text-sand transition hover:bg-ink/85"
      >
        {submitLabel}
      </button>
    </form>
  )
}
