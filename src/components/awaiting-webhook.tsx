'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Refresca la página mientras se espera el webhook de Stripe.
 *
 * Volver del checkout no confirma nada: la confirmación llega servidor a
 * servidor y tarda un par de segundos. Sin esto, el huésped ve «pagado» en
 * Stripe y «pendiente» aquí, y hay que pedirle que actualice a mano.
 *
 * No contradice la regla de no sondear (docs/COSTO-CERO.md, 3.7): son tres
 * intentos con espera creciente y se acaban. No es un bucle que siga corriendo
 * mientras la pestaña esté abierta, que es lo que consumiría cuota.
 *
 * Solo se monta cuando la reserva sigue pendiente tras volver del pago; en
 * cuanto el servidor la devuelve confirmada, el padre deja de renderizarlo.
 */
const DELAYS_MS = [2000, 4000, 8000]

export function AwaitingWebhook() {
  const router = useRouter()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (attempt >= DELAYS_MS.length) return

    const timer = setTimeout(() => {
      router.refresh()
      setAttempt((n) => n + 1)
    }, DELAYS_MS[attempt])

    return () => clearTimeout(timer)
  }, [attempt, router])

  const exhausted = attempt >= DELAYS_MS.length

  return (
    <p className="mt-5 rounded-xl border border-tide/40 bg-tide/5 px-4 py-3 text-sm text-tide">
      {exhausted ? (
        <>
          El pago se registró en Stripe, pero la confirmación está tardando más de lo
          normal. Escríbenos y lo resolvemos — tu dinero no se ha perdido.
        </>
      ) : (
        <>Recibimos tu pago y lo estamos confirmando. Un momento…</>
      )}
    </p>
  )
}
