'use client'

import { useActionState, useState } from 'react'
import { saveSection, type ContentState } from '@/app/admin/contenido/actions'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

type Section = Record<string, unknown>

const str = (s: Section | undefined, key: string) =>
  typeof s?.[key] === 'string' ? (s[key] as string) : ''

const list = <T,>(s: Section | undefined, key: string): T[] =>
  Array.isArray(s?.[key]) ? (s[key] as T[]) : []

export function ContentSections({ content }: { content: Record<string, Section> }) {
  return (
    <div className="space-y-5">
      <Panel
        sectionKey="hero"
        heading="Portada"
        hint="Lo primero que se ve al entrar."
        data={content.hero}
      >
        {(data) => (
          <>
            <Text name="title" label="Titular" value={str(data, 'title')} />
            <Area name="subtitle" label="Subtítulo" value={str(data, 'subtitle')} rows={2} />
          </>
        )}
      </Panel>

      <Panel
        sectionKey="about"
        heading="Sobre el negocio"
        hint="Deja una línea en blanco para separar párrafos."
        data={content.about}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area name="body" label="Texto" value={str(data, 'body')} rows={6} />
          </>
        )}
      </Panel>

      <Panel
        sectionKey="services"
        heading="Servicios"
        hint="Lo que incluye la estadía."
        data={content.services}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Repeat
              value={list<{ label: string; detail: string }>(data, 'items')}
              empty={{ label: '', detail: '' }}
              addLabel="Añadir servicio"
              render={(item, update) => (
                <>
                  <input
                    value={item.label}
                    onChange={(e) => update({ ...item, label: e.target.value })}
                    placeholder="Desayuno incluido"
                    className={field}
                  />
                  <input
                    value={item.detail}
                    onChange={(e) => update({ ...item, detail: e.target.value })}
                    placeholder="Arepas, café y fruta de temporada."
                    className={field}
                  />
                </>
              )}
            />
          </>
        )}
      </Panel>

      <Panel sectionKey="location" heading="Cómo llegar" data={content.location}>
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area name="body" label="Indicaciones" value={str(data, 'body')} rows={4} />
            <Text name="address" label="Dirección" value={str(data, 'address')} />
          </>
        )}
      </Panel>

      <Panel
        sectionKey="faq"
        heading="Preguntas frecuentes"
        hint="Las que te repiten por WhatsApp. Cada una que respondas aquí es una menos que contestar a mano."
        data={content.faq}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Repeat
              value={list<{ q: string; a: string }>(data, 'items')}
              empty={{ q: '', a: '' }}
              addLabel="Añadir pregunta"
              render={(item, update) => (
                <>
                  <input
                    value={item.q}
                    onChange={(e) => update({ ...item, q: e.target.value })}
                    placeholder="¿Cómo confirmo mi reserva?"
                    className={field}
                  />
                  <textarea
                    value={item.a}
                    onChange={(e) => update({ ...item, a: e.target.value })}
                    rows={3}
                    className={field}
                  />
                </>
              )}
            />
          </>
        )}
      </Panel>

      <Panel sectionKey="contact" heading="Contacto" data={content.contact}>
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area name="body" label="Texto" value={str(data, 'body')} rows={2} />
          </>
        )}
      </Panel>
    </div>
  )
}

function Panel({
  sectionKey,
  heading,
  hint,
  data,
  children,
}: {
  sectionKey: string
  heading: string
  hint?: string
  data?: Section
  children: (data?: Section) => React.ReactNode
}) {
  const [state, action, pending] = useActionState<ContentState, FormData>(saveSection, {})

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-sm font-medium">{heading}</h2>
      {hint && <p className="mt-1 text-sm text-ink/50">{hint}</p>}

      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="key" value={sectionKey} />
        {children(data)}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            disabled={pending}
            className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
          {state.ok && <span className="text-sm text-moss">{state.ok}</span>}
          {state.error && <span className="text-sm text-red-700">{state.error}</span>}
        </div>
      </form>
    </section>
  )
}

function Text({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink/60">{label}</span>
      <input name={name} defaultValue={value} className={field} />
    </label>
  )
}

function Area({
  name,
  label,
  value,
  rows,
}: {
  name: string
  label: string
  value: string
  rows: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink/60">{label}</span>
      <textarea name={name} defaultValue={value} rows={rows} className={field} />
    </label>
  )
}

/**
 * Lista editable que viaja como JSON en un campo oculto.
 *
 * Un `<input>` por fila con nombres indexados obligaría a reconstruir el orden
 * en el servidor y se rompe al borrar filas intermedias. Serializar el arreglo
 * completo deja una sola fuente de verdad.
 */
function Repeat<T>({
  value,
  empty,
  addLabel,
  render,
}: {
  value: T[]
  empty: T
  addLabel: string
  render: (item: T, update: (next: T) => void) => React.ReactNode
}) {
  const [items, setItems] = useState<T[]>(value)

  const update = (index: number, next: T) =>
    setItems(items.map((item, i) => (i === index ? next : item)))

  const remove = (index: number) => setItems(items.filter((_, i) => i !== index))

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const copy = [...items]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    setItems(copy)
  }

  return (
    <div>
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-ink/10 p-3">
            <div className="space-y-2">{render(item, (next) => update(i, next))}</div>
            <div className="mt-2 flex items-center gap-3 text-xs text-ink/45">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="ml-auto underline hover:text-red-700"
              >
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setItems([...items, empty])}
        className="mt-3 rounded-lg border border-ink/15 px-4 py-1.5 text-sm transition hover:border-ink/40"
      >
        {addLabel}
      </button>
    </div>
  )
}
