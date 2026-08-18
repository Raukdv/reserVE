/**
 * Imagen de una unidad, con marcador de reserva.
 *
 * Si hay foto cargada se pinta la foto. Si no, un degradado derivado del slug,
 * así que cada unidad conserva su color entre recargas y entre el listado y el
 * detalle — un gris igual para todas haría que un catálogo sin fotos pareciera
 * roto en lugar de vacío.
 *
 * El degradado se queda detrás de la imagen aunque haya foto: es lo que se ve
 * mientras carga, y lo que queda si el archivo falla. Sin él, el hueco es
 * blanco y la tarjeta salta al terminar de bajar.
 *
 * Sin `next/image` a propósito: la optimización de imágenes de Vercel se cobra
 * aparte en el plan Hobby. Ver COSTO-CERO.md, regla 3.5. Por eso las fotos se
 * comprimen al subirlas, que es cuando sale gratis.
 */

const PALETTES = [
  ['#c8a882', '#8a6a4a'],
  ['#8fa89a', '#4a5d4e'],
  ['#c9a0a0', '#8a5f5f'],
  ['#a8a2c0', '#5f5a7a'],
  ['#d0b48a', '#9a7d4a'],
  ['#93a8b8', '#546a7a'],
]

function hash(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function UnitThumb({
  slug,
  label,
  className = '',
  src,
  alt,
  priority = false,
}: {
  slug: string
  label?: string
  className?: string
  /** URL de la foto. Sin ella se pinta solo el degradado. */
  src?: string | null
  alt?: string | null
  /** La portada visible al abrir la página: se carga sin diferir. */
  priority?: boolean
}) {
  const [from, to] = PALETTES[hash(slug) % PALETTES.length]

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden={!label && !alt}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt ?? ''}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 20%, rgba(255,255,255,.55), transparent 45%),' +
              'radial-gradient(circle at 80% 75%, rgba(0,0,0,.35), transparent 50%)',
          }}
        />
      )}

      {label && !src && (
        <span className="absolute bottom-3 left-4 text-xs font-medium uppercase tracking-widest text-white/80">
          {label}
        </span>
      )}
    </div>
  )
}
