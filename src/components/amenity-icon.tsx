import { AMENITY_ICONS } from '@/lib/amenities'

/**
 * Icono de una amenidad.
 *
 * Si el nombre guardado no está en el mapa —porque se escribió a mano o se
 * retiró del juego de iconos— cae en un punto neutro. Una amenidad sin icono
 * sigue siendo legible; una página rota, no.
 */
export function AmenityIcon({
  name,
  className = 'h-4 w-4',
}: {
  name: string | null
  className?: string
}) {
  const Icon = name ? AMENITY_ICONS[name] : undefined

  if (!Icon) {
    return (
      <span
        className={`${className} flex shrink-0 items-center justify-center`}
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-clay" />
      </span>
    )
  }

  return <Icon className={`${className} shrink-0`} strokeWidth={1.75} aria-hidden />
}
