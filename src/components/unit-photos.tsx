'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  uploadPhoto,
  deletePhoto,
  movePhoto,
  type UnitState,
} from '@/app/admin/unidades/actions'
import { compressImage, kb } from '@/lib/compress-image'
import {
  MAX_PHOTOS_PER_UNIT,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_KB,
  PHOTO_COMPRESSION,
} from '@/lib/media-limits'

export type UnitPhoto = { id: string; url: string; sortOrder: number }

export function UnitPhotos({ unitId, photos }: { unitId: string; photos: UnitPhoto[] }) {
  const [state, dispatch, pending] = useActionState<UnitState, FormData>(uploadPhoto, {})
  const [submitting, startSubmit] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [original, setOriginal] = useState<number | null>(null)
  const [working, setWorking] = useState(false)

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    if (!picked) {
      setFile(null)
      setOriginal(null)
      return
    }
    setWorking(true)
    setOriginal(picked.size)
    setFile(await compressImage(picked, PHOTO_COMPRESSION))
    setWorking(false)
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (file) data.set('photo', file)
    startSubmit(() => dispatch(data))
  }

  const full = photos.length >= MAX_PHOTOS_PER_UNIT
  const oversized = file !== null && file.size > MAX_PHOTO_BYTES
  const busy = pending || submitting || working

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6">
      <h2 className="text-base font-semibold">Fotos</h2>
      <p className="mt-1 text-descripcion text-ink/70">
        La primera es la que se ve en el catálogo. Se comprimen antes de subir.
      </p>
      <p className="mt-1 text-xs text-ink/60">
        {photos.length} de {MAX_PHOTOS_PER_UNIT} · máximo {MAX_PHOTO_KB} KB por foto ya
        comprimida
      </p>

      {photos.length > 0 && (
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {photos.map((photo, i) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt=""
                className="aspect-[4/3] w-full bg-ink/5 object-cover"
              />
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="text-ink/60">
                  {i === 0 ? 'Portada' : `Foto ${i + 1}`}
                </span>
                <span className="flex items-center gap-2">
                  {i > 0 && <MoveButton id={photo.id} direction="up" label="←" />}
                  {i < photos.length - 1 && (
                    <MoveButton id={photo.id} direction="down" label="→" />
                  )}
                  <DeleteButton id={photo.id} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="mt-5 rounded-xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink/70">
          Esta unidad llegó a {MAX_PHOTOS_PER_UNIT} fotos, que es el máximo. Borra alguna
          para subir otra.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <input type="hidden" name="unitId" value={unitId} />
          <input
            name="photo"
            type="file"
            accept="image/*"
            required
            onChange={onPick}
            className="w-full rounded-xl border border-dashed border-ink/25 bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink/8 file:px-3 file:py-1.5 file:text-sm"
          />

          {working && <p className="text-xs text-ink/60">Optimizando…</p>}
          {file && original !== null && !working && (
            <p className={`text-xs ${oversized ? 'text-red-700' : 'text-ink/60'}`}>
              {original === file.size
                ? kb(file.size)
                : `${kb(original)} → ${kb(file.size)} tras optimizar`}
              {/*
                Se avisa aquí y no al enviar: la compresión ya terminó, así que
                el peso final se conoce antes de gastar la subida. El servidor
                lo vuelve a comprobar de todas formas.
              */}
              {oversized && ` · pasa de ${MAX_PHOTO_KB} KB, prueba con otra imagen`}
            </p>
          )}

          {state.error && <p className="text-sm text-red-700">{state.error}</p>}

          <button
            disabled={busy || oversized}
            className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
          >
            {pending || submitting ? 'Subiendo…' : 'Añadir foto'}
          </button>
        </form>
      )}
    </section>
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
