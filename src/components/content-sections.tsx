'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { saveSection, type ContentState } from '@/app/admin/contenido/actions'

const field =
  'w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40'

type Section = Record<string, unknown>

const str = (s: Section | undefined, key: string) => {
  const value = s?.[key]
  if (typeof value === 'string') return value
  // Las coordenadas se guardan como número y el campo las necesita en texto.
  if (typeof value === 'number') return String(value)
  return ''
}

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

      <Panel
        sectionKey="location"
        heading="Cómo llegar"
        data={content.location}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area name="body" label="Indicaciones" value={str(data, 'body')} rows={4} />
            <Text name="address" label="Dirección" value={str(data, 'address')} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="lat" label="Latitud" value={str(data, 'lat')} />
              <Text name="lng" label="Longitud" value={str(data, 'lng')} />
            </div>
            <p className="text-xs text-ink/60">
              En Google Maps, pulsa con el botón derecho sobre el punto exacto: los dos
              números que salen arriba son latitud y longitud. Sin ellos no se dibuja el
              mapa, solo la foto.
            </p>
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

      <div className="pt-3">
        <h2 className="text-base font-semibold">Textos legales</h2>
        <p className="mt-1 text-descripcion text-ink/70">
          Enlazados desde el pie de todas las páginas. Mientras estén vacíos, la página
          muestra un aviso con tus datos de contacto en lugar de un texto inventado.
        </p>
        <p className="mt-2 text-xs text-ink/60">
          Son documentos vinculantes: redáctalos tú o con quien te asesore. Deja una línea
          en blanco entre párrafos.
        </p>
      </div>

      <Panel
        sectionKey="legal_condiciones"
        heading="Condiciones de reserva"
        data={content.legal_condiciones}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area
              name="body"
              label="Texto"
              value={str(data, 'body')}
              rows={10}
              placeholder={
                'Qué incluye la tarifa y qué no.\n\n' +
                'Horarios de entrada y salida.\n\n' +
                'Anticipo exigido y plazo para pagarlo.\n\n' +
                'Normas de la casa: mascotas, visitas, ruido.\n\n' +
                'Responsabilidad por daños.'
              }
            />
          </>
        )}
      </Panel>

      {/*
        Cancelación no se redacta aquí a propósito.
        Es el único texto legal que además mueve dinero: lo que dice tiene que
        ser lo que `cancellation_quote()` calcula. Se publica generado desde los
        tramos, y el título y el texto de apoyo se editan en Ajustes, pegados a
        esos tramos, para que nadie escriba una promesa que el servidor no vaya
        a cumplir.
      */}
      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <h3 className="text-sm font-medium">Política de cancelación</h3>
        <p className="mt-1 text-sm text-ink/70">
          Se publica sola a partir de los tramos de reembolso: lo que lee el huésped es
          exactamente lo que se le devuelve. El título y el texto de apoyo están en{' '}
          <Link href="/admin/ajustes" className="underline">
            Ajustes → Políticas
          </Link>
          .
        </p>
      </div>

      <Panel
        sectionKey="legal_privacidad"
        heading="Privacidad"
        data={content.legal_privacidad}
      >
        {(data) => (
          <>
            <Text name="title" label="Título" value={str(data, 'title')} />
            <Area
              name="body"
              label="Texto"
              value={str(data, 'body')}
              rows={8}
              placeholder={
                'Qué datos se recogen: nombre, correo, teléfono, documento, comprobantes de pago.\n\n' +
                'Para qué se usan y cuánto tiempo se conservan.\n\n' +
                'Con quién se comparten: pasarela de pago, servicio de correo.\n\n' +
                'Cómo pedir su eliminación.'
              }
            />
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
      <h2 className="text-base font-semibold">{heading}</h2>
      {hint && <p className="mt-1 text-descripcion text-ink/70">{hint}</p>}

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
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input name={name} defaultValue={value} className={field} />
    </label>
  )
}

function Area({
  name,
  label,
  value,
  rows,
  placeholder,
}: {
  name: string
  label: string
  value: string
  rows: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <textarea
        name={name}
        defaultValue={value}
        rows={rows}
        placeholder={placeholder}
        className={field}
      />
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
            <div className="mt-2 flex items-center gap-3 text-xs text-ink/60">
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
