'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { createBlock, type BlockState } from '@/app/admin/calendario/actions'

/** Ancho de una columna de día, en píxeles. Compartido por cabeceras y barras. */
export const DAY_WIDTH = 28

const ROW_HEIGHT = 44

/**
 * Ancho de la columna de unidades, en píxeles. Es el `w-44` de las filas.
 *
 * Se repite aquí como número porque la barra de arriba necesita saber cuánto
 * mide la rejilla entera, y eso no se puede leer de una clase de Tailwind. Si
 * cambia `w-44`, cambia esto.
 */
const UNIT_COL_WIDTH = 176

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

/** Un mes de la cabecera, con cuántas columnas de la ventana le tocan. */
export type MonthSpan = { name: string; short: string; span: number }

export type GridUnit = { id: string; name: string }

/**
 * El día siguiente, en ISO.
 *
 * La salida de un bloqueo puede caer fuera de los 45 días pintados, así que no
 * sirve leer la columna de al lado. En UTC a propósito: las claves de la rejilla
 * son fechas sin hora y `setUTCDate` no las mueve al cruzar un cambio horario.
 */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

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
 * ## Con el ratón: arrastrar, o clic y clic
 *
 * Arrastrar sobre los días libres cierra el rango al soltar. Y un clic suelto
 * propone una noche, que después se estira con un segundo clic en el día final:
 * el extremo más cercano se lleva hasta ahí. Las dos formas conviven porque la
 * cómoda depende del largo — una noche se marca de un clic, doce días se
 * arrastran mal si hay que cruzar media pantalla.
 *
 * Lo delicado es que al **pulsar** sobre una selección ya abierta todavía no se
 * sabe qué quiere el operador: puede ser el clic que ajusta el extremo, o el
 * principio de un arrastre nuevo. Por eso la pulsación queda en espera y lo
 * decide el primer `mouseenter`: si el ratón se mueve, era arrastre y se empieza
 * de cero; si se suelta sin moverse, era clic y se mueve el extremo.
 *
 * ## En táctil: dos toques dentro de un modo
 *
 * El arrastre se apoya en `mousedown` y `mouseenter`, que en una pantalla táctil
 * no existen. Imitarlo con `touchmove` obligaría a `preventDefault` sobre el
 * contenedor, y eso mata el scroll horizontal — que en una rejilla de 45 días es
 * justo lo que hace falta para llegar a la fecha.
 *
 * Así que en táctil se selecciona con **dos toques**: uno marca el inicio y otro
 * el fin. Van dentro de un modo explícito porque con el dedo no hay diferencia
 * entre «toco para seleccionar» y «toco para abrir la reserva»; sin el modo,
 * cualquier toque sería ambiguo.
 *
 * El botón se muestra siempre, no solo bajo `(pointer: coarse)`: no estorba en
 * escritorio, da salida si el arrastre se atasca, y como dentro del modo las
 * casillas pasan a ser `<button>` de verdad, es además la única forma de
 * bloquear con el teclado.
 *
 * Un tercer toque mueve el extremo más cercano en vez de empezar de cero. Con el
 * dedo se falla la casilla más de lo que uno cree, y obligar a reiniciar la
 * selección por un día de diferencia es lo que hace abandonar.
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
  months,
  bars,
  todayIso,
}: {
  units: GridUnit[]
  days: Day[]
  months: MonthSpan[]
  bars: Bar[]
  todayIso: string
}) {
  /** Arrastre en curso con el ratón. */
  const [drag, setDrag] = useState<{ unitId: string; a: number; b: number } | null>(null)
  /** Selección ya cerrada, esperando confirmación. Índices, no fechas. */
  const [range, setRange] = useState<{ unitId: string; a: number; b: number } | null>(null)
  /** Modo de selección por toques. */
  const [tapMode, setTapMode] = useState(false)
  /** Primer toque, a la espera del segundo. */
  const [anchor, setAnchor] = useState<{ unitId: string; i: number } | null>(null)
  /** Pulsación sobre una selección abierta, sin saber aún si es clic o arrastre. */
  const [espera, setEspera] = useState<{ unitId: string; i: number } | null>(null)

  /** Las dos barras horizontales: la de arriba y la de la rejilla. */
  const railRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  /**
   * Iguala el desplazamiento de una barra en la otra.
   *
   * La comparación no es una optimización: asignar `scrollLeft` dispara otro
   * evento `scroll` en la que recibe, que volvería a llamar aquí. Sin la guarda
   * las dos se llamarían en bucle.
   */
  const sync = (desde: HTMLDivElement | null, hacia: HTMLDivElement | null) => {
    if (!desde || !hacia || hacia.scrollLeft === desde.scrollLeft) return
    hacia.scrollLeft = desde.scrollLeft
  }

  // Qué columnas de cada unidad están tomadas: seleccionar sobre ellas no debe
  // proponer un bloqueo que la base va a rechazar de todas formas.
  const taken = new Map<string, Set<number>>()
  for (const bar of bars) {
    if (!taken.has(bar.unitId)) taken.set(bar.unitId, new Set())
    const set = taken.get(bar.unitId)!
    for (let i = 0; i < bar.span; i++) set.add(bar.offset + i)
  }

  const free = (unitId: string, i: number) => !taken.get(unitId)?.has(i)

  /**
   * Hasta dónde llega la selección desde `from` hacia `to` sin saltarse una
   * estadía.
   *
   * Sin esto se podía seleccionar de un lado a otro de una barra: las casillas
   * ocupadas se ignoraban, pero la de más allá sí extendía el rango y el bloqueo
   * salía con una estadía dentro. La base lo rechazaba por el `EXCLUDE`, así que
   * nada se rompía, pero el operador recibía un error en vez de un tope visible.
   */
  function reach(unitId: string, from: number, to: number) {
    const step = to >= from ? 1 : -1
    let last = from
    for (let i = from + step; step > 0 ? i <= to : i >= to; i += step) {
      if (!free(unitId, i)) break
      last = i
    }
    return last
  }

  function clearSelection() {
    setRange(null)
    setAnchor(null)
    setEspera(null)
  }

  function toggleTapMode() {
    setTapMode((on) => !on)
    clearSelection()
    setDrag(null)
  }

  /**
   * Lleva el extremo más cercano de la selección hasta `i`.
   *
   * Es lo que permite ajustar sin rehacer: da igual que se llegue por un tercer
   * toque en táctil o por un segundo clic con el ratón.
   */
  function moverExtremo(unitId: string, i: number) {
    if (!range || range.unitId !== unitId) return
    const cercaDeA = Math.abs(i - range.a) <= Math.abs(i - range.b)
    setRange(
      cercaDeA
        ? { ...range, a: reach(unitId, range.b, i) }
        : { ...range, b: reach(unitId, range.a, i) },
    )
  }

  function onTap(unitId: string, i: number) {
    // Tercer toque sobre una selección ya cerrada: mueve el extremo más cercano.
    if (range && range.unitId === unitId) {
      moverExtremo(unitId, i)
      return
    }

    // Segundo toque en la misma unidad: cierra el rango.
    if (anchor && anchor.unitId === unitId) {
      setRange({ unitId, a: anchor.i, b: reach(unitId, anchor.i, i) })
      setAnchor(null)
      return
    }

    // El primero, o un toque en otra unidad: se empieza allí.
    setAnchor({ unitId, i })
    setRange(null)
  }

  /*
    Soltar el ratón. Tres finales posibles:

    - Había una pulsación en espera sobre una selección ya abierta y no se llegó
      a mover → era un **segundo clic**: se lleva el extremo hasta ahí.
    - Había un arrastre → se cierra el rango.
    - Nada → nada.

    La espera existe porque al pulsar sobre una selección abierta todavía no se
    sabe qué quiere el operador: puede ser un clic para ajustar el extremo, o el
    principio de un arrastre nuevo. Lo decide el primer `mouseenter`.
  */
  function finishDrag() {
    if (espera !== null) {
      moverExtremo(espera.unitId, espera.i)
      setEspera(null)
      return
    }
    if (!drag) return
    setRange(drag)
    setDrag(null)
  }

  const span = drag ?? range

  const inSpan = (unitId: string, i: number) =>
    span !== null &&
    span.unitId === unitId &&
    i >= Math.min(span.a, span.b) &&
    i <= Math.max(span.a, span.b)

  const isAnchor = (unitId: string, i: number) =>
    anchor?.unitId === unitId && anchor.i === i

  // El rango es semiabierto, igual que en la base: bloquear la columna del día 3
  // significa `[3, 4)`, así que la salida es el día siguiente al último elegido.
  //
  // Se calcula sumando un día, no leyendo la columna siguiente. Antes se recortaba
  // a la última pintada, y seleccionar el día 45 —el borde de la ventana— daba
  // `from == to`: un rango vacío que no choca con nada y entraba como bloqueo
  // inútil. Con el arrastre costaba llegar ahí; tabulando hasta el final, no.
  const pick = range
    ? {
        unitId: range.unitId,
        from: days[Math.min(range.a, range.b)].key,
        to: nextDay(days[Math.max(range.a, range.b)].key),
      }
    : null

  return (
    <>
      {pick && (
        <BlockConfirm
          unitName={units.find((u) => u.id === pick.unitId)?.name ?? ''}
          pick={pick}
          onClose={() => {
            clearSelection()
            setTapMode(false)
          }}
        />
      )}

      {/*
        Barra de desplazamiento espejo, encima de la rejilla.

        Con veinte unidades la rejilla mide varias pantallas de alto y la única
        barra horizontal quedaba al fondo: para mover el calendario a la derecha
        había que bajar hasta el final, moverlo, y volver a subir.

        Es un contenedor vacío del mismo ancho total que la rejilla, así que el
        navegador le da su propia barra. Las dos se sincronizan en los dos
        sentidos; la guarda de igualdad corta la realimentación, porque asignar
        `scrollLeft` dispara otro `scroll` y sin ella se llamarían en bucle.

        `aria-hidden` porque no aporta nada a quien no ve: es la misma región que
        ya está debajo, y anunciarla dos veces solo estorba.
      */}
      <div
        ref={railRef}
        onScroll={() => sync(railRef.current, gridRef.current)}
        aria-hidden
        // La altura es explícita porque la barra se dibuja **dentro** de la caja
        // del contenedor, no debajo. Con el alto del contenido —un píxel— el
        // navegador la recortaría entera y no habría nada que arrastrar. 18 px
        // cubren la barra de Windows, que es la más alta de las tres.
        className="mt-6 h-[18px] overflow-x-auto"
      >
        <div style={{ width: `${UNIT_COL_WIDTH + days.length * DAY_WIDTH}px`, height: 1 }} />
      </div>

      <div
        ref={gridRef}
        onScroll={() => sync(gridRef.current, railRef.current)}
        className="mt-1 overflow-x-auto rounded-2xl border border-ink/10 bg-white"
      >
        <div
          className="min-w-max"
          onMouseUp={finishDrag}
          onMouseLeave={() => {
            setDrag(null)
            setEspera(null)
          }}
        >
          {/*
            La fila de meses va aquí dentro, no encima de la caja.

            Estaba en su propio contenedor con scroll, así que al desplazar la
            rejilla los meses se quedaban quietos y dejaban de corresponderse
            con los días. Se entendía al rato, mirando dos veces — que es
            justamente lo que una cabecera no debe pedir.

            Dentro del mismo `min-w-max` comparten desplazamiento, y el nombre
            se apoya en el borde izquierdo del mes: el mismo borde marcado que
            llevan la columna del día 1 y sus celdas más abajo.
          */}
          <div className="flex border-b border-ink/8 bg-ink/3">
            <div className="w-44 shrink-0 border-r border-ink/10" />
            {months.map((m) => (
              <div
                key={m.name}
                style={{ width: `${m.span * DAY_WIDTH}px` }}
                className="shrink-0 overflow-hidden border-l border-ink/20 px-1.5 py-1 text-[11px] font-medium text-ink/70 first:border-l-0 first-letter:uppercase"
                title={m.name}
              >
                {/* Con pocos días en la ventana, el nombre largo no cabe. */}
                {m.span >= 5 ? m.name : m.short}
              </div>
            ))}
          </div>

          <div className="flex border-b border-ink/10">
            <div className="w-44 shrink-0 border-r border-ink/10 px-3 py-2 text-xs font-medium text-ink/70">
              Unidad
            </div>
            {days.map((d) => (
              <div
                key={d.key}
                className={`w-7 shrink-0 py-1 text-center text-[10px] leading-tight ${
                  // El día 1 hereda el borde del mes: es lo que ata la cabecera
                  // de arriba con la columna concreta donde empieza.
                  d.key.endsWith('-01') ? 'border-l border-ink/20' : ''
                } ${
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

                  const fondo = inSpan(unit.id, i)
                    ? 'bg-clay/40'
                    : d.key === todayIso
                      ? 'bg-clay/10'
                      : d.weekend
                        ? 'bg-ink/3'
                        : ''

                  // El extremo a la espera del segundo toque tiene que verse
                  // distinto del rango cerrado: si no, el modo selección no se
                  // distingue del normal y no hay pista de que falte un toque.
                  const marca = isAnchor(unit.id, i)
                    ? 'bg-clay/40 ring-2 ring-inset ring-ink/50'
                    : fondo

                  // El cambio de mes se marca en toda la altura de la rejilla,
                  // no solo en la cabecera: es lo que permite saber en qué mes
                  // cae una barra sin subir la vista hasta arriba.
                  const inicioDeMes = d.key.endsWith('-01') ? 'border-l border-ink/20' : ''

                  const clase = `w-7 shrink-0 border-r border-ink/5 ${inicioDeMes} ${marca}`

                  if (tapMode) {
                    return (
                      <button
                        key={d.key}
                        type="button"
                        disabled={!selectable}
                        onClick={() => onTap(unit.id, i)}
                        aria-pressed={inSpan(unit.id, i) || isAnchor(unit.id, i)}
                        aria-label={`${unit.name}, ${d.key}${selectable ? '' : ' (ocupado)'}`}
                        className={`${clase} ${
                          selectable ? 'cursor-pointer' : 'cursor-not-allowed'
                        } focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink`}
                      />
                    )
                  }

                  return (
                    <div
                      key={d.key}
                      onMouseDown={() => {
                        if (!selectable) return
                        // Sobre una selección abierta, la pulsación queda en
                        // espera: puede ser un clic para ajustar o el principio
                        // de un arrastre nuevo. Lo decide si el ratón se mueve.
                        if (range?.unitId === unit.id) setEspera({ unitId: unit.id, i })
                        else setDrag({ unitId: unit.id, a: i, b: i })
                      }}
                      onMouseEnter={() => {
                        if (espera) {
                          // Se movió: era arrastre. Se empieza de cero desde la
                          // casilla que se pulsó.
                          setRange(null)
                          setDrag({ unitId: espera.unitId, a: espera.i, b: reach(espera.unitId, espera.i, i) })
                          setEspera(null)
                          return
                        }
                        if (drag?.unitId === unit.id) {
                          setDrag({ ...drag, b: reach(unit.id, drag.a, i) })
                        }
                      }}
                      className={`${clase} ${selectable ? 'cursor-crosshair' : ''}`}
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
                      // Dentro del modo selección las barras no deben interceptar
                      // el toque ni el tabulador: manda la casilla de debajo.
                      tabIndex={tapMode ? -1 : undefined}
                      className={`absolute top-1.5 flex items-center overflow-hidden px-1.5 text-[10px] font-medium leading-none ${
                        bar.tone
                      } ${bar.openStart ? 'rounded-l-md' : ''} ${
                        bar.openEnd ? 'rounded-r-md' : ''
                      } ${tapMode ? 'pointer-events-none' : ''}`}
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

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={toggleTapMode}
          aria-pressed={tapMode}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            tapMode
              ? 'border-ink bg-ink text-sand'
              : 'border-ink/20 text-ink hover:border-ink/40'
          }`}
        >
          {tapMode ? 'Salir del modo selección' : 'Seleccionar por toques'}
        </button>

        {/*
          Fuera del modo, la instrucción depende del puntero: en una pantalla
          táctil el arrastre no existe, así que decir «arrastra» manda al
          operador a intentar algo que no puede funcionar. Se resuelve con las
          variantes de Tailwind y no con `matchMedia`, para que el servidor y el
          cliente pinten lo mismo y no haya desajuste de hidratación.
        */}
        <p className="text-xs text-ink/60">
          {tapMode ? (
            anchor ? (
              'Toca el último día del bloqueo. Otro toque después mueve el extremo.'
            ) : (
              'Toca el primer día libre del bloqueo.'
            )
          ) : (
            <>
              <span className="pointer-coarse:hidden">
                Arrastra sobre los días libres, o haz clic en el primer día y otro en el último.
              </span>
              <span className="hidden pointer-coarse:inline">
                Toca «Seleccionar por toques» y marca el primer y el último día.
              </span>
            </>
          )}
        </p>
      </div>
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
