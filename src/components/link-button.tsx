import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

/**
 * Enlace que va a otra pantalla, con forma de control.
 *
 * ## Por qué existe
 *
 * El nivel terciario —texto subrayado— hacía cuatro trabajos con la misma pinta:
 * navegar a otra página, borrar algo, enlazar dentro de una frase y ser la
 * acción principal de un estado vacío. Con 65 enlaces así frente a 46 botones
 * con borde, el elemento interactivo más común del sitio era el que menos se
 * distinguía del texto.
 *
 * Esto cubre solo el primer trabajo: **ir a otro sitio**. Lo demás sigue siendo
 * texto a propósito — un botón llamativo para «Borrar» invita al accidente, y un
 * enlace dentro de un párrafo debe parecer un enlace, no un control incrustado.
 *
 * ## Por qué píldora y no texto
 *
 * WCAG 2.5.8 pide un objetivo de al menos 24×24 px. Un enlace de 14 px mide unos
 * 14 de alto: no llega, y en móvil se falla al pulsarlo. Con `px-4 py-2` el
 * objetivo pasa de 36 px de alto.
 *
 * El icono no es adorno: es lo que hace que se lea como control antes de leer la
 * etiqueta. `lucide-react` ya está en el proyecto y hace *tree-shaking*, así que
 * cada icono nuevo no suma peso apreciable.
 */
export function LinkButton({
  href,
  icon: Icon,
  children,
  external = false,
  tone = 'secundario',
  className = '',
}: {
  href: string
  icon?: LucideIcon
  children: React.ReactNode
  /** Abre en otra pestaña. Para salir a la web pública desde el panel. */
  external?: boolean
  /** `principal` para la única acción que se espera en un estado vacío. */
  tone?: 'principal' | 'secundario'
  className?: string
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ' +
    'whitespace-nowrap'

  const skin =
    tone === 'principal'
      ? 'bg-ink text-sand hover:bg-ink/85'
      : 'border border-ink/15 bg-white hover:border-ink/40'

  return (
    <Link
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={`${base} ${skin} ${className}`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </Link>
  )
}
