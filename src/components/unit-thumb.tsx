/**
 * Marcador visual para unidades sin fotos cargadas.
 *
 * El degradado se deriva del slug, así que cada unidad conserva su color entre
 * recargas y entre el listado y el detalle. Se reemplaza por unit_media en
 * cuanto haya imágenes reales.
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
}: {
  slug: string
  label?: string
  className?: string
}) {
  const [from, to] = PALETTES[hash(slug) % PALETTES.length]

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden={!label}
    >
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 20%, rgba(255,255,255,.55), transparent 45%),' +
            'radial-gradient(circle at 80% 75%, rgba(0,0,0,.35), transparent 50%)',
        }}
      />
      {label && (
        <span className="absolute bottom-3 left-4 text-xs font-medium uppercase tracking-widest text-white/80">
          {label}
        </span>
      )}
    </div>
  )
}
