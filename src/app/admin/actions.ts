'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/supabase/server'
import { fetchAndStoreRate } from '@/lib/bcv'
import { getRateSummary } from '@/lib/rates'

export type RefreshState = { error?: string; ok?: string }

/**
 * Pide la tasa ahora, sin esperar al cron.
 *
 * El alimentador corre una vez al día —lo único que permite el plan Hobby—, así
 * que entre una corrida y la siguiente no había forma de traer una tasa recién
 * publicada. Esto la trae.
 *
 * **No salta las comprobaciones.** «Forzar» aquí es forzar la consulta, no la
 * validación: los guardias de divergencia entre fuentes y de salto diario
 * siguen aplicando, porque existen para que una lectura mala no acabe cobrando
 * de más. Saltárselos desde un botón sería poner un interruptor a la única
 * defensa que hay sobre el número con el que se factura.
 *
 * Y si la tasa que llega ya está guardada con el mismo importe, no se escribe
 * nada: pulsar tres veces no deja tres escrituras idénticas.
 */
export async function refreshRate(): Promise<RefreshState> {
  const profile = await getProfile()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return { error: 'No tienes permiso para esto.' }
  }

  const result = await fetchAndStoreRate()

  if (!result.ok) {
    return { error: `No se pudo actualizar: ${result.detail}` }
  }

  revalidatePath('/admin')
  revalidatePath('/', 'layout')

  /*
    Se informa de la tasa **que rige hoy**, no de la que se acaba de guardar.

    No son lo mismo: el BCV publica por la tarde para el día siguiente, así que
    una consulta a las seis puede traer una fecha valor de mañana. Decir «tasa
    actualizada a 775,33» mientras el panel sigue mostrando 773,31 —que es la
    correcta para cobrar hoy— pone dos cifras distintas en la misma pantalla y
    deja al operador sin saber con cuál cotiza.

    Lo traído se menciona aparte, como lo que es: lo que entrará en vigor.
  */
  const summary = await getRateSummary()

  const vigente = summary.rate
    ? `${summary.rate.toLocaleString('es-VE')} Bs/USD (fecha valor ${summary.rateDate})`
    : 'sin tasa aplicable'

  const partes = [
    result.changed ? 'Consulta hecha, hay dato nuevo.' : 'Consulta hecha, sin cambios.',
    `Hoy se cobra a ${vigente}.`,
  ]

  if (result.partial) partes.push('Una de las dos fuentes no respondió.')

  return { ok: partes.join(' ') }
}
