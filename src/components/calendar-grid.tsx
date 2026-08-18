'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { createBlock, type BlockState } from '@/app/admin/calendario/actions'

/** Ancho de una columna de día, en píxeles. Compartido por cabeceras y barras. */
export const DAY_WIDTH = 28

const ROW_HEIGHT = 44

export type Bar = {
  unitId: string
  /** Índice de la columna donde empieza, ya recortado a la ventana visible. */
  offset: number
  /** Cuántas columnas ocupa. */
  span: number
  tone: string
  label: string
  title: string
  href: string
  /** Falsos cuando la estadía se sale de la ventana por ese lado. */
  openStart: boolean
  openEnd: boolean
}

export type Day = { key: string; letter: string; num: string; weekend: boolean }

export type GridUnit = { id: string; name: string }

/**
 * Rejilla del calendario: unidades × días, con las estadías como barras.
 *
 * ## Por qué las barras van a media celda
 *
 * Una estadía ocupa la habitación desde el mediodía de la entrada hasta el
 * mediodía de la salida. Pintarla como celdas completas —que es lo que hacía
 * antes— es correcto respecto al modelo, porque el rango `[)` deja libre la
 * noche de salida, pero se lee como si el día de salida estuviera ocupado
 * entero.
 *
 * Desplazándola media columna, el día en que uno sale y otro entra se ve como
 * dos mitades compartiendo el cuadro. Es como lo dibujan los PMS comerciales, y
 * responde de un vistazo la pregunta que más se hace el operador: «¿puedo meter
 * a alguien ese día?».
 *
 * El ancho no cambia: sigue siendo una columna por noche. Solo se corre.
 *
 * ## Por qué las barras están fuera del flujo
 *
 * Antes cada día era una celda coloreada y la etiqueta se estiraba por encima.
 * Con el desplazamiento eso deja de funcionar: media celda pertenece a una
 * estadía y media a otra. Ahora las celdas son solo fondo y las barras se
 * posicionan en absoluto sobre la fila.
 */
export function CalendarGrid({
  units,
  days,
  bars,
  todayIso,
}: {
  units: GridUnit[]
  days: Day[]
  bars: Bar[]
  todayIso: string
}) {
  const [drag, setDrag] = useState<{ unitId: string; a: number; b: number } | null>(null)
  const [pick, setPick] = useState<{ unitId: string; from: string; to: string } | null>(null)

  // Qué columnas de cada unidad están tomadas: arrastrar sobre ellas no debe
  // proponer un bloqueo que la base va a rechazar de todas formas.
  const taken = new Map<string, Set<number>>()
  for (const bar of bars) {
    if (!taken.has(bar.unitId)) taken.set(bar.unitId, new Set())
    const set = taken.get(bar.unitId)!
    for (let i = 0; i < bar.span; i++) set.add(bar.offset + i)
  }

  const free = (unitId: string, i: number) => !taken.get(unitId)?.has(i)

  function finishDrag() {
    if (!drag) return
    const from = Math.min(drag.a, drag.b)
    const to = Math.max(drag.a, drag.b)

    // El rango es semiabierto, igual que en la base: bloquear la columna del
    // día 3 significa `[3, 4)`, así que la salida es el día siguiente al último
    // arrastrado.
    setPick({
      unitId: drag.unitId,
      from: days[from].key,
      to: days[Math.min(to + 1, days.length - 1)].key,
    })
    setDrag(null)
  }

  const inDrag = (unitId: string, i: number) =>
    drag !== null &&
    drag.unitId === unitId &&
    i >= Math.min(drag.a, drag.b) &&
    i <= Math.max(drag.a, drag.b)

  return (
    <>
      {pick && (
        <BlockConfirm
          unitName={units.find((u) => u.id === pick.unitId)?.name ?? ''}
          pick={pick}
          onClose={() => setPick(null)}
        />
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/10 bg-white">
        <div className="min-w-max" onMouseUp={finishDrag} onMouseLeave={() => setDrag(null)}>
          <div className="flex border-b border-ink/10">
            <div className="w-44 shrink-0 border-r border-ink/10 px-3 py-2 text-xs font-medium text-ink/70">
              Unidad
            </div>
            {days.map((d) => (
              <div
                key={d.key}
                className={`w-7 shrink-0 py-1 text-center text-[10px] leading-tight ${
                  d.key === todayIso
                    ? 'bg-clay/20 font-semibold'
                    : d.weekend
                      ? 'bg-ink/3'
                      : ''
                }`}
              >
                <div className="text-ink/60">{d.letter}</div>
                <div>{d.num}</div>
              </div>
            ))}
          </div>

          {units.map((unit) => (
            <div key={unit.id} className="flex border-b border-ink/8 last:border-b-0">
              <div className="w-44 shrink-0 truncate border-r border-ink/10 px-3 py-2.5 text-sm">
                {unit.name}
              </div>

              <div className="relative flex" style={{ height: `${ROW_HEIGHT}px` }}>
                {days.map((d, i) => {
                  const selectable = free(unit.id, i)
                  return (
                    <div
                      key={d.key}
                      onMouseDown={() => selectable && setDrag({ unitId: unit.id, a: i, b: i })}
                      onMouseEnter={() =>
                        drag?.unitId === unit.id && selectable && setDrag({ ...drag, b: i })
                      }
                      className={`w-7 shrink-0 border-r border-ink/5 ${
                        inDrag(unit.id, i)
                          ? 'bg-clay/40'
                          : d.key === todayIso
                            ? 'bg-clay/10'
                            : d.weekend
                              ? 'bg-ink/3'
                              : ''
                      } ${selectable ? 'cursor-crosshair' : ''}`}
                    />
                  )
                })}

                {bars
                  .filter((b) => b.unitId === unit.id)
                  .map((bar, k) => (
                    <Link
                      key={k}
                      href={bar.href}
                      title={bar.title}
                      className={`absolute top-1.5 flex items-center overflow-hidden px-1.5 text-[10px] font-medium leading-none ${bar.tone} ${
                        bar.openStart ? 'rounded-l-md' : ''
                      } ${bar.openEnd ? 'rounded-r-md' : ''}`}
                      style={{
                        // Media columna a la derecha: la entrada es a mediodía.
                        left: `${bar.offset * DAY_WIDTH + DAY_WIDTH / 2}px`,
                        width: `${bar.span * DAY_WIDTH - 2}px`,
                        height: `${ROW_HEIGHT - 12}px`,
                      }}
                    >
                      <span className="truncate">{bar.label}</span>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-ink/60">
        Arrastra sobre los días libres de una unidad para bloquearlos.
      </p>
    </>
  )
}

/** Confirmación del bloqueo dibujado a mano sobre la rejilla. */
function BlockConfirm({
  unitName,
  pick,
  onClose,
}: {
  unitName: string
  pick: { unitId: string; from: string; to: string }
  onClose: () => void
}) {
  const [state, action, pending] = useActionState<BlockState, FormData>(createBlock, {})

  if (state.ok) queueMicrotask(onClose)

  return (
    <div className="mt-4 rounded-2xl border border-clay/60 bg-white p-5">
      <p className="text-sm font-medium">Bloquear {unitName}</p>
      <p className="mt-1 text-sm text-ink/70">
        Del {pick.from} al {pick.to}. La salida queda libre, como en cualquier estadía.
      </p>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="unitId" value={pick.unitId} />
        <input type="hidden" name="from" value={pick.from} />
        <input type="hidden" name="to" value={pick.to} />

        <label className="block min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink">Motivo</span>
          <input
            name="reason"
            placeholder="Mantenimiento, uso propio…"
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
          />
        </label>

        <button
          disabled={pending}
          className="rounded-lg bg-ink px-5 py-2 text-sm text-sand disabled:opacity-50"
        >
          {pending ? 'Bloqueando…' : 'Bloquear'}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="pb-2 text-sm text-ink/70 underline"
        >
          Cancelar
        </button>

        {state.error && <span className="pb-2 text-sm text-red-700">{state.error}</span>}
      </form>
    </div>
  )
}
