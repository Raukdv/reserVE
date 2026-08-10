'use client'

import { useState } from 'react'
import {
  DOCUMENT_TYPES,
  composeDocument,
  parseDocument,
  validateDocument,
  type DocumentType,
} from '@/lib/document'

/**
 * Selector de tipo más número, que envía un solo valor compuesto.
 *
 * El campo visible es el `<input>` del número; el valor que viaja al servidor va
 * en un campo oculto ya normalizado (`V-27866046`). Así la base guarda una sola
 * cadena y el formulario se encarga de armarla.
 *
 * La validación aquí es solo ayuda: el servidor vuelve a comprobarla, porque el
 * cliente se puede saltar.
 */
export function DocumentInput({
  name,
  label = 'Documento',
  defaultValue,
  defaultType = 'V',
  required = false,
  hint,
}: {
  name: string
  label?: string
  defaultValue?: string | null
  defaultType?: DocumentType
  required?: boolean
  hint?: string
}) {
  const initial = defaultValue ? parseDocument(defaultValue) : { type: defaultType, number: '' }

  const [type, setType] = useState<DocumentType>(initial.type)
  const [number, setNumber] = useState(initial.number)
  const [touched, setTouched] = useState(false)

  const composed = composeDocument(type, number) ?? ''
  const error = number.trim() ? validateDocument(type, number) : null
  const showError = touched && Boolean(error)

  const placeholder =
    type === 'J' ? '123456789' : type === 'P' ? 'AB1234567' : '27866046'

  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink/60">{label}</span>

      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as DocumentType)}
          aria-label="Tipo de documento"
          className="w-20 shrink-0 rounded-xl border border-ink/15 bg-white px-2 py-2.5 text-sm outline-none focus:border-ink/40"
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value} title={t.label}>
              {t.short}
            </option>
          ))}
        </select>

        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onBlur={() => setTouched(true)}
          required={required}
          placeholder={placeholder}
          inputMode={type === 'P' ? 'text' : 'numeric'}
          aria-invalid={showError}
          className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40 ${
            showError ? 'border-red-400' : 'border-ink/15'
          }`}
        />
      </div>

      {/* Lo que se guarda: ya normalizado y con su prefijo. */}
      <input type="hidden" name={name} value={composed} />

      {showError ? (
        <span className="mt-1 block text-xs text-red-700">{error}</span>
      ) : (
        <span className="mt-1 block text-xs text-ink/45">
          {hint ?? DOCUMENT_TYPES.find((t) => t.value === type)?.label}
        </span>
      )}
    </label>
  )
}
