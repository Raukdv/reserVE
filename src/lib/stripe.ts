import 'server-only'

import Stripe from 'stripe'
import { serverEnv } from '@/lib/env'

/**
 * Cliente de Stripe.
 *
 * Devuelve null cuando no hay clave configurada, en lugar de lanzar: sin Stripe
 * la app funciona igual —el reporte manual de comprobante es el camino
 * principal— y la pasarela aparece como «faltan credenciales» en ajustes.
 */
let cached: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached

  const { STRIPE_SECRET_KEY } = serverEnv()
  cached = STRIPE_SECRET_KEY
    ? new Stripe(STRIPE_SECRET_KEY, { typescript: true })
    : null

  return cached
}

export function stripeEnabled() {
  return Boolean(serverEnv().STRIPE_SECRET_KEY)
}

/**
 * Cierto si la clave configurada es de sandbox.
 *
 * Se usa para avisar en la interfaz: una pasarela en modo prueba que parece real
 * lleva a creer que se cobró dinero que nunca se movió.
 */
export function stripeIsTestMode() {
  return serverEnv().STRIPE_SECRET_KEY?.startsWith('sk_test_') ?? false
}

/** Stripe trabaja en la unidad mínima: 12,34 USD son 1234. */
export const toMinorUnits = (usd: number) => Math.round(usd * 100)
export const fromMinorUnits = (cents: number) => cents / 100
