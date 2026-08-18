'use client'

import { useActionState, useRef, useState } from 'react'
import {
  uploadSiteImage,
  deleteSiteImage,
  type ContentState,
} from '@/app/admin/contenido/actions'
import { compressImage, kb } from '@/lib/compress-image'
import {
  MAX_SITE_PHOTOS_PER_SECTION,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_KB,
  PHOTO_COMPRESSION,
} from '@/lib/media-limits'

export type SiteImage = { id: string; url: string }

/**
 * Fotos de una sección del sitio.
 *
 * Son fotos del **negocio**, no de una unidad: la casa, la terraza, el entorno.
 * Van junto al texto de la misma sección porque se editan a la vez — quien
 * escribe «sobre la posada» tiene delante la foto que la acompaña.
 *
 * Misma mecánica que las de unidad —arrastrar, selección múltiple, subida al
 * elegir, cola secuencial— por la misma razón: cada acción de servidor lleva un
 * archivo y comprimir varias a la vez congela el navegador.
 */
export function SiteImages({
  section,
  images,
  hint,
}: {
  section: string
  images: SiteImage[]
  hint: string
}) {
  const [jobs, setJobs] = useState<{ name: string; detail: string; bad: boolean }[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const room = MAX_SITE_PHOTOS_PER_SECTION - images.length

  async function enqueue(files: File[]) {
    const batch = files.filter((f) => f.type.startsWith('image/')).slice(0, room)
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
      data.set('section', section)
      data.set('image', small)

      const result = await uploadSiteImage({}, data)
      mark(i, result.error ?? kb(small.size), Boolean(result.error))
    }

    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink/60">Fotos</p>
      <p className="mt-1 text-sm text-ink/70">{hint}</p>

      {images.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {images.map((image, i) => (
            <li key={image.id} className="w-32">
              <div className="overflow-hidden rounded-lg border border-ink/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="aspect-[4/3] w-full object-cover" />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-ink/60">{i === 0 ? 'Principal' : `Foto ${i + 1}`}</span>
                <RemoveButton id={image.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {room > 0 ? (
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
          className={`mt-3 rounded-xl border border-dashed p-4 text-center transition ${
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
            className="rounded-lg border border-ink/15 bg-white px-4 py-1.5 text-sm transition hover:border-ink/40 disabled:opacity-50"
          >
            {busy ? 'Subiendo…' : 'Añadir fotos'}
          </button>
          <p className="mt-1 text-xs text-ink/60">
            Arrastra aquí o pulsa. Se suben solas. Caben {room} más.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink/60">
          Máximo de {MAX_SITE_PHOTOS_PER_SECTION} fotos en esta sección.
        </p>
      )}

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
    </div>
  )
}

function RemoveButton({ id }: { id: string }) {
  const [, action, pending] = useActionState<ContentState, FormData>(deleteSiteImage, {})

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        disabled={pending}
        className="text-ink/60 underline hover:text-red-700 disabled:opacity-50"
      >
        {pending ? '…' : 'Borrar'}
      </button>
    </form>
  )
}
