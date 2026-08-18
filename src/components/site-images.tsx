'use client'

import { useActionState, useRef, useState } from 'react'
import {
  uploadSiteImage,
  deleteSiteImage,
  setSiteImageSection,
  type ContentState,
} from '@/app/admin/contenido/actions'
import { SITE_IMAGE_SECTIONS } from '@/lib/site-sections'
import { compressImage, kb } from '@/lib/compress-image'
import { MAX_PHOTO_BYTES, MAX_PHOTO_KB, PHOTO_COMPRESSION } from '@/lib/media-limits'

export type SiteImage = { id: string; url: string; section: string }

/**
 * Fotos del negocio, todas en un sitio.
 *
 * Antes había una caja de subida por sección: tres cajas idénticas en la misma
 * página, y la única pista de cuál era cuál estaba en el título varios
 * centímetros más arriba. Es un error fácil de cometer y no había forma de
 * corregirlo salvo borrar la foto y volver a subirla.
 *
 * Ahora la galería es una sola y **cada foto lleva encima a dónde va**. El
 * destino deja de ser el resultado de acordarse de en qué caja se soltó, y pasa
 * a ser un dato visible y editable de la propia foto.
 *
 * Las recién subidas entran «sin asignar»: se sube el lote y se reparte después,
 * que es como se trabaja de verdad.
 */
export function SiteImages({ images }: { images: SiteImage[] }) {
  const [jobs, setJobs] = useState<{ name: string; detail: string; bad: boolean }[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function enqueue(files: File[]) {
    const batch = files.filter((f) => f.type.startsWith('image/'))
    if (batch.length === 0) return

    setBusy(true)
    setJobs(batch.map((f) => ({ name: f.name, detail: 'optimizando…', bad: false })))

    const mark = (i: number, detail: string, bad = false) =>
      setJobs((prev) => prev.map((j, k) => (k === i ? { ...j, detail, bad } : j)))

    for (let i = 0; i < batch.length; i++) {
      const small = await compressImage(batch[i], PHOTO_COMPRESSION)

      if (small.size > MAX_PHOTO_BYTES) {
        mark(i, `${kb(small.size)}, supera ${MAX_PHOTO_KB} KB`, true)
        continue
      }

      const data = new FormData()
      data.set('image', small)

      const result = await uploadSiteImage({}, data)
      mark(i, result.error ?? kb(small.size), Boolean(result.error))
    }

    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-base font-semibold">Fotos del sitio</h2>
      <p className="mt-1 text-descripcion text-ink/70">
        Del negocio, no de una habitación: la casa, el patio, la entrada. Las de cada
        alojamiento se suben en su ficha.
      </p>

      {images.length > 0 && (
        <ul className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <li key={image.id} className="rounded-xl border border-ink/10 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt=""
                className="aspect-[4/3] w-full rounded-lg bg-ink/5 object-cover"
              />

              {/*
                Dos formularios hermanos, no anidados: el HTML no admite un
                `form` dentro de otro, y meter el borrado dentro del selector
                obligaba a usar `formAction` con `name` en el mismo botón —
                cosa que React necesita para codificar la acción y que rompía
                la hidratación.
              */}
              <div className="mt-2">
                <span className="mb-1 block text-xs font-medium text-ink">Foto</span>
                <SectionPicker id={image.id} section={image.section} />
                <DeleteButton id={image.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!busy) enqueue(Array.from(e.dataTransfer.files))
        }}
        className={`mt-5 rounded-xl border border-dashed p-6 text-center transition ${
          dragging ? 'border-ink/50 bg-sand' : 'border-ink/25'
        }`}
      >
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => enqueue(Array.from(e.target.files ?? []))}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm transition hover:border-ink/40 disabled:opacity-50"
        >
          {busy ? 'Subiendo…' : 'Añadir fotos'}
        </button>
        <p className="mt-2 text-xs text-ink/60">
          Arrastra aquí o pulsa. Entran sin asignar y les das destino abajo de cada una.
        </p>
      </div>

      {jobs.length > 0 && (
        <ul className="mt-3 space-y-1">
          {jobs.map((job, i) => (
            <li key={i} className="flex flex-wrap gap-2 text-xs">
              <span className="min-w-0 truncate text-ink/70">{job.name}</span>
              <span className={job.bad ? 'text-red-700' : 'text-ink/60'}>{job.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A dónde va esta foto.
 *
 * Se envía al cambiar, sin botón de guardar: el `select` ya es la confirmación,
 * y un «Guardar» por foto en una rejilla de doce sería ruido.
 */
function SectionPicker({ id, section }: { id: string; section: string }) {
  const [state, action, pending] = useActionState<ContentState, FormData>(
    setSiteImageSection,
    {},
  )

  const current = SITE_IMAGE_SECTIONS.find((s) => s.key === section)

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <select
        name="section"
        defaultValue={section}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-ink/40 disabled:opacity-50"
      >
        {SITE_IMAGE_SECTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <span className="mt-1 block text-xs text-ink/60">
        {pending ? 'Moviendo…' : (state.error ?? current?.where)}
      </span>
    </form>
  )
}

function DeleteButton({ id }: { id: string }) {
  const [, action, pending] = useActionState<ContentState, FormData>(deleteSiteImage, {})

  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="id" value={id} />
      <button
        disabled={pending}
        className="text-xs text-ink/60 underline hover:text-red-700 disabled:opacity-50"
      >
        {pending ? '…' : 'Borrar'}
      </button>
    </form>
  )
}
