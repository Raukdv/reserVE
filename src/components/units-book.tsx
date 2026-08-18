'use client'

import { useState } from 'react'
import Link from 'next/link'
import { UnitThumb } from '@/components/unit-thumb'

/**
 * Duración del giro, en milisegundos.
 *
 * Un solo número porque lo usan dos sitios que tienen que coincidir: la
 * transición de CSS y el temporizador que asienta la página al terminar. Si se
 * separan, o la hoja desaparece antes de acabar de girar o se queda un instante
 * de más antes de soltar el contenido nuevo.
 */
const FLIP_MS = 600

export type BookPage = {
  id: string
  name: string
  slug: string
  description: string | null
  meta: string
  /** Precio ya formateado en el servidor: el cliente no calcula dinero. */
  price: string
  coverUrl?: string | null
  coverAlt?: string | null
}

/**
 * El catálogo como un libro que se hojea.
 *
 * El juego es con la palabra: reservar es *to book*, y el catálogo se pasa
 * página a página. Cada hoja es un alojamiento.
 *
 * ## Cómo funciona el giro
 *
 * CSS 3D puro, sin librería de animación. El contenedor abre `perspective` y la
 * hoja que gira lleva `transform-origin` en el lomo, de modo que rota sobre el
 * pliegue igual que el papel. `backface-visibility: hidden` es lo que permite
 * pintar las dos caras en el mismo elemento: la de delante es la página que se
 * va, la de detrás es la que llega.
 *
 * Durante el giro se pinta una hoja extra por encima del pliego; al terminar se
 * cambia el índice y esa hoja desaparece. Sin ese elemento intermedio el salto
 * sería instantáneo.
 *
 * ## Por qué el móvil se queda con la rejilla
 *
 * Un pliego son dos páginas lado a lado. En 360 px de ancho cada una queda en
 * 180, que no da ni para la foto. Y el gesto natural en táctil es deslizar, no
 * pulsar flechas. Abajo de `sm` se muestra la rejilla de siempre — es una
 * decisión de CSS, sin JavaScript que la sostenga.
 */
export function UnitsBook({ pages, allHref }: { pages: BookPage[]; allHref: string }) {
  // Se añade una hoja de cierre para que el libro no acabe en un hueco y para
  // que siempre haya salida al catálogo completo.
  const sheets: (BookPage | null)[] = [...pages]
  if (sheets.length % 2 === 1) sheets.push(null)

  const spreads = Math.ceil(sheets.length / 2)

  const [spread, setSpread] = useState(0)
  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)

  const left = sheets[spread * 2] ?? null
  const right = sheets[spread * 2 + 1] ?? null

  // Lo que se verá al otro lado de la hoja que gira.
  const nextLeft = sheets[(spread + 1) * 2] ?? null
  const prevRight = sheets[(spread - 1) * 2 + 1] ?? null

  const canPrev = spread > 0 && turning === null
  const canNext = spread < spreads - 1 && turning === null

  function flip(direction: 'next' | 'prev') {
    if (direction === 'next' ? !canNext : !canPrev) return
    setTurning(direction)

    // Al terminar el giro se asienta el índice y la hoja móvil se retira.
    window.setTimeout(() => {
      setSpread((s) => s + (direction === 'next' ? 1 : -1))
      setTurning(null)
    }, FLIP_MS)
  }

  return (
    <div className="mt-10">
      <div
        className="relative mx-auto flex w-full max-w-4xl"
        style={{ perspective: '2200px' }}
      >
        <Sheet page={left} side="left" />
        <Sheet page={right} side="right" />

        {/* El lomo. Dos sombras encontradas dan el hundimiento del papel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-8 -translate-x-1/2"
          style={{
            background:
              'linear-gradient(to right, rgba(22,19,15,0) 0%, rgba(22,19,15,.16) 45%, ' +
              'rgba(22,19,15,.22) 50%, rgba(22,19,15,.16) 55%, rgba(22,19,15,0) 100%)',
          }}
        />

        {/*
          Sombra que la hoja proyecta sobre la página de destino. Va debajo de la
          hoja y encima del pliego, y sube y baja: sin ella la hoja parece flotar
          sin tocar nada.
        */}
        {turning && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 w-1/2 ${
              turning === 'next' ? 'left-0' : 'left-1/2'
            }`}
            style={{
              zIndex: 10,
              background: `linear-gradient(to ${turning === 'next' ? 'left' : 'right'},
                rgba(22,19,15,.55) 0%, rgba(22,19,15,0) 70%)`,
              animation: `hoja-sombra ${FLIP_MS}ms cubic-bezier(.4,.05,.2,1) both`,
            }}
          />
        )}

        {/* Hoja en movimiento: solo existe mientras dura el giro. */}
        {turning && (
          <div
            aria-hidden
            className={`absolute inset-y-0 ${turning === 'next' ? 'left-1/2' : 'left-0'} w-1/2`}
            style={{
              transformStyle: 'preserve-3d',
              transformOrigin: turning === 'next' ? 'left center' : 'right center',
              transform: `rotateY(${turning === 'next' ? -180 : 180}deg)`,
              transition: `transform ${FLIP_MS}ms cubic-bezier(.4,.05,.2,1)`,
              zIndex: 20,
            }}
          >
            <Face spine={turning === 'next' ? 'left' : 'right'}>
              <Sheet
                page={turning === 'next' ? right : left}
                side={turning === 'next' ? 'right' : 'left'}
                bare
              />
            </Face>
            <Face back spine={turning === 'next' ? 'right' : 'left'}>
              <Sheet
                page={turning === 'next' ? nextLeft : prevRight}
                side={turning === 'next' ? 'left' : 'right'}
                bare
              />
            </Face>
          </div>
        )}
      </div>

      <div className="mx-auto mt-5 flex max-w-4xl items-center justify-between gap-4">
        <Arrow onClick={() => flip('prev')} disabled={!canPrev} label="Anterior">
          ← Anterior
        </Arrow>

        <p className="text-xs uppercase tracking-wider text-ink/60">
          {spread + 1} de {spreads}
        </p>

        <Arrow onClick={() => flip('next')} disabled={!canNext} label="Siguiente">
          Siguiente →
        </Arrow>
      </div>

      {/* Salida al catálogo completo, visible desde cualquier página. */}
      <p className="mt-4 text-center">
        <Link href={allHref} className="text-sm underline hover:text-ink">
          Ver todos los alojamientos
        </Link>
      </p>
    </div>
  )
}

/**
 * Una cara de la hoja que gira, con su luz.
 *
 * `backface-visibility: hidden` esconde el reverso; sin eso se vería el
 * contenido invertido en espejo a media vuelta.
 *
 * Encima va una capa oscura cuya opacidad se anima: la cara de delante pierde
 * luz según se pone de canto, y la de detrás aparece en sombra y se aclara. Es
 * lo que separa «papel que se levanta» de «plano que rota».
 *
 * El degradado va más oscuro junto al lomo, que es donde el papel se dobla y
 * menos luz recibe. El lado del lomo cambia según sea la cara de delante o la
 * de detrás, porque el reverso está espejado.
 */
function Face({
  children,
  back = false,
  spine,
}: {
  children: React.ReactNode
  back?: boolean
  /** Dónde queda el lomo en esta cara. */
  spine: 'left' | 'right'
}) {
  return (
    <div
      className="absolute inset-0"
      style={{
        backfaceVisibility: 'hidden',
        transform: back ? 'rotateY(180deg)' : undefined,
      }}
    >
      {children}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(to ${spine === 'left' ? 'right' : 'left'},
            rgba(22,19,15,.9) 0%, rgba(22,19,15,.45) 35%, rgba(22,19,15,.25) 100%)`,
          animation: `${back ? 'hoja-dorso' : 'hoja-frente'} ${FLIP_MS}ms cubic-bezier(.4,.05,.2,1) both`,
        }}
      />
    </div>
  )
}

/** Página del libro: un alojamiento, o el cierre cuando se acaban. */
function Sheet({
  page,
  side,
  bare = false,
}: {
  page: BookPage | null
  side: 'left' | 'right'
  /** Dentro de la hoja en movimiento, donde el ancho lo pone el padre. */
  bare?: boolean
}) {
  const paper =
    side === 'left'
      ? 'rounded-l-xl bg-gradient-to-r from-sand to-white'
      : 'rounded-r-xl bg-gradient-to-l from-sand to-white'

  const frame = `${bare ? 'h-full w-full' : 'w-1/2'} border border-ink/10 ${paper}`

  /*
    Hoja de cierre, sin enlace.

    El enlace al catálogo vive abajo y se ve siempre: aquí solo aparecería al
    llegar a la última página, y quien quiere entrar directo no debería tener
    que hojear el cuaderno entero para encontrarlo.
  */
  if (!page) {
    return (
      <div className={`${frame} flex flex-col items-center justify-center p-8 text-center`}>
        <p className="text-entrada text-ink/70">Hasta aquí llega el cuaderno.</p>
        <p className="mt-2 text-sm text-ink/60">Gracias por hojearlo.</p>
      </div>
    )
  }

  return (
    <Link href={`/alojamientos/${page.slug}`} className={`${frame} group block p-4 sm:p-5`}>
      <UnitThumb
        slug={page.slug}
        src={page.coverUrl}
        alt={page.coverAlt ?? page.name}
        className="aspect-[4/3] w-full rounded-lg"
      />

      <div className="pt-4">
        <h3 className="text-lg font-medium group-hover:underline">{page.name}</h3>
        {page.description && (
          <p className="mt-2 line-clamp-2 text-sm text-ink/70">{page.description}</p>
        )}
        <p className="mt-3 text-xs text-ink/70">{page.meta}</p>
        <p className="mt-2 text-sm font-medium">
          {page.price}
          <span className="font-normal text-ink/70"> / noche</span>
        </p>
      </div>
    </Link>
  )
}

function Arrow({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm transition hover:border-ink/40 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
