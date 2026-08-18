import { MapPin } from 'lucide-react'
import { LinkButton } from '@/components/link-button'

/**
 * Mapa de la sección «cómo llegar».
 *
 * ## Por qué OpenStreetMap y no Google
 *
 * Las tres formas de poner un mapa son gratis, así que el coste no decide.
 * Deciden otras dos cosas:
 *
 * - **Un iframe de Google rastrea al huésped.** Pone cookies y le asocia la
 *   visita a una página que aún tiene que declararlo en su política de
 *   privacidad. OSM no manda nada a nadie.
 * - **Pesa.** Google carga varios cientos de KB en un teléfono con conexión
 *   venezolana; es el mismo argumento con el que se descartó Motion.
 *
 * Y un tercero, práctico: **nadie navega desde un iframe**. Se mira dónde queda
 * y se pulsa para abrirlo en el teléfono. El mapa incrustado solo responde
 * «¿dónde está?», y para eso OSM sirve igual. Por eso debajo va el botón que
 * sale a Google Maps, que es donde la gente tiene sus rutas.
 *
 * La opción oficial de Google —la Embed API— también es gratuita e ilimitada,
 * pero exige clave y cuenta de facturación activa en Google Cloud. Trámite con
 * tarjeta, que en Venezuela no es trivial. El endpoint heredado sin clave
 * funciona pero no está documentado y puede retirarse sin aviso.
 */

/** Margen alrededor del punto, en grados. Da una vista de barrio. */
const SPAN = 0.006

export function LocationMap({
  lat,
  lng,
  label,
}: {
  lat: number
  lng: number
  /** Qué se busca en Google al pulsar el botón. La dirección si la hay. */
  label?: string | null
}) {
  const bbox = [lng - SPAN, lat - SPAN / 2, lng + SPAN, lat + SPAN / 2].join(',')

  const osm =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`

  // Coordenadas y no la dirección: un nombre ambiguo lleva a otro pueblo, un
  // punto no se equivoca. La etiqueta va aparte para que se lea al llegar.
  const google =
    `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` +
    (label ? `&query_place_id=${encodeURIComponent(label)}` : '')

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-ink/10">
        <iframe
          src={osm}
          title="Mapa de la ubicación"
          // Diferido: el mapa está debajo del pliegue y no debe competir con la
          // carga de lo que sí se ve al entrar.
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-72 w-full border-0"
        />
      </div>

      <p className="mt-3">
        <LinkButton href={google} icon={MapPin} external>
          Abrir en Google Maps
        </LinkButton>
      </p>
    </div>
  )
}
