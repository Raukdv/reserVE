'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import {
  uploadPhoto,
  deletePhoto,
  movePhoto,
  setCover,
  type UnitState,
} from '@/app/admin/unidades/actions'
import { compressImage, kb } from '@/lib/compress-image'
import {
  MAX_PHOTOS_PER_UNIT,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_KB,
  PHOTO_COMPRESSION,
} from '@/lib/media-limits'

export type UnitPhoto = { id: string; url: string; sortOrder: number; isCover: boolean }

/** Una foto en la cola, con su estado propio. */
type Job = {
  name: string
  state: 'optimizando' | 'subiendo' | 'lista' | 'error'
  detail?: string
}

/**
 * Fotos de una unidad.
 *
 * Se sube en cuanto se eligen los archivos, sin botón de confirmar: elegir ya es
 * confirmar. Admite arrastrar y soltar, y varias a la vez.
 *
 * La cola es **secuencial**, no paralela, por dos razones: cada acción de
 * servidor lleva un archivo —el límite de cuerpo por defecto de Next es 1 MB, y
 * varias fotos no caben— y comprimir varias imágenes a la vez satura el hilo
 * del navegador y congela la página.
 *
 * Un archivo que falle no cancela los demás: el error es por imagen.
 */
export function UnitPhotos({ unitId, photos }: { unitId: string; photos: UnitPhoto[] }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const full = photos.length >= MAX_PHOTOS_PER_UNIT
  const room = MAX_PHOTOS_PER_UNIT - photos.length

  async function enqueue(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return

    // Se recorta a lo que cabe antes de empezar, para no comprimir en balde lo
    // que el servidor va a rechazar de todas formas.
    const batch = images.slice(0, room)
    const dropped = images.length - batch.length

    setBusy(true)
    setJobs(batch.map((f) => ({ name: f.name, state: 'optimizando' })))

    const mark = (i: number, next: Partial<Job>) =>
      setJobs((prev) => prev.map((j, k) => (k === i ? { ...j, ...next } : j)))

    for (let i = 0; i < batch.length; i++) {
      const compressed = await compressImage(batch[i], PHOTO_COMPRESSION)

      if (compressed.size > MAX_PHOTO_BYTES) {
        mark(i, { state: 'error', detail: `${kb(compressed.size)}, supera ${MAX_PHOTO_KB} KB` })
        continue
      }

      mark(i, { state: 'subiendo', detail: kb(compressed.size) })

      const data = new FormData()
      data.set('unitId', unitId)
      data.set('photo', compressed)

      const result = await uploadPhoto({}, data)

      mark(
        i,
        result.error
          ? { state: 'error', detail: result.error }
          : { state: 'lista', detail: kb(compressed.size) },
      )
    }

    if (dropped > 0) {
      setJobs((prev) => [
        ...prev,
        {
          name: `${dropped} sin subir`,
          state: 'error',
          detail: `solo caben ${MAX_PHOTOS_PER_UNIT} por unidad`,
        },
      ])
    }

    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-base font-semibold">Fotos</h2>
      <p className="mt-1 text-descripcion text-ink/70">
        La marcada como portada es la que se ve en el catálogo. El orden del resto manda
        en la galería.
      </p>
      <p className="mt-1 text-xs text-ink/60">
        {photos.length} de {MAX_PHOTOS_PER_UNIT} · máximo {MAX_PHOTO_KB} KB por foto ya
        comprimida
      </p>

      {photos.length > 0 && (
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {photos.map((photo, i) => {
            // Sin ninguna marcada, la portada es la primera — igual que hace la
            // vista unit_covers. Así el panel no promete algo distinto de lo que
            // se publica.
            const isCover = photos.some((p) => p.isCover) ? photo.isCover : i === 0

            return (
              <li
                key={photo.id}
                className={`overflow-hidden rounded-xl border ${
                  isCover ? 'border-ink/40' : 'border-ink/10'
                }`}
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt=""
                    className="aspect-[4/3] w-full bg-ink/5 object-cover"
                  />
                  {isCover && (
                    <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] text-sand">
                      Portada
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  {isCover ? (
                    <span className="text-ink/60">Foto {i + 1}</span>
                  ) : (
                    <CoverButton id={photo.id} />
                  )}

                  <span className="flex items-center gap-2">
                    {i > 0 && <MoveButton id={photo.id} direction="up" label="←" />}
                    {i < photos.length - 1 && (
                      <MoveButton id={photo.id} direction="down" label="→" />
                    )}
                    <DeleteButton id={photo.id} />
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {full ? (
        <p className="mt-5 rounded-xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink/70">
          Esta unidad llegó a {MAX_PHOTOS_PER_UNIT} fotos, que es el máximo. Borra alguna
          para subir otra.
        </p>
      ) : (
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

          <p className="text-sm text-ink/70">
            {busy ? 'Subiendo…' : 'Arrastra las fotos aquí'}
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="mt-3 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm transition hover:border-ink/40 disabled:opacity-50"
          >
            Buscar en el equipo
          </button>

          <p className="mt-2 text-xs text-ink/60">
            Se suben solas al elegirlas. Caben {room} más.
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="mt-4 space-y-1">
          {jobs.map((job, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span
                className={
                  job.state === 'error'
                    ? 'text-red-700'
                    : job.state === 'lista'
                      ? 'text-moss'
                      : 'text-ink/70'
                }
              >
                {job.state === 'lista' ? '✓' : job.state === 'error' ? '×' : '…'}
              </span>
              <span className="min-w-0 truncate text-ink/70">{job.name}</span>
              {job.detail && <span className="text-ink/60">{job.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CoverButton({ id }: { id: string }) {
  const [, action, pending] = useActionState<UnitState, FormData>(setCover, {})

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-ink/70 underline hover:text-ink disabled:opacity-50">
        {pending ? '…' : 'Hacer portada'}
      </button>
    </form>
  )
}

function MoveButton({
  id,
  direction,
  label,
}: {
  id: string
  direction: 'up' | 'down'
  label: string
}) {
  const [, action, pending] = useActionState<UnitState, FormData>(movePhoto, {})

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        disabled={pending}
        className="text-ink/60 hover:text-ink disabled:opacity-50"
        aria-label={direction === 'up' ? 'Mover antes' : 'Mover después'}
      >
        {label}
      </button>
    </form>
  )
}

function DeleteButton({ id }: { id: string }) {
  const [, action, pending] = useActionState<UnitState, FormData>(deletePhoto, {})

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        disabled={pending}
        className="text-ink/60 hover:text-red-700 disabled:opacity-50"
      >
        {pending ? '…' : 'Borrar'}
      </button>
    </form>
  )
}
