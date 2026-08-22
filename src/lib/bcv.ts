import 'server-only'

import https from 'node:https'
import { createAdminClient } from '@/lib/supabase/server'
import { BUSINESS_TZ } from '@/lib/timezone'

/**
 * Obtención y almacenamiento de las tasas USD/VES.
 *
 * **Oficial (BCV).** Única legal para cobrar. El BCV publica de lunes a viernes
 * entre las 4 y las 5 de la tarde (hora de Venezuela) y la tasa **entra en
 * vigencia el día hábil siguiente**, así que lo que se guarda como `rate_date`
 * es la *fecha valor* que el propio BCV declara, no el día en que se descargó.
 *
 * La tasa oficial no cambia durante la jornada —es un promedio ponderado
 * publicado una vez—, de modo que una lectura diaria no es una aproximación:
 * es exacta. Consultar más seguido no aportaría precisión.
 *
 * **Paralelo.** Se registra solo como métrica de brecha, para decidir el precio
 * de lista en USD. Cobrar a una tasa distinta de la oficial es infracción a la
 * Ley de Precios Justos, así que `current_rate()` la ignora por completo.
 *
 * La oficial se contrasta entre dos fuentes antes de escribirse. Cobrar con una
 * tasa equivocada es peor que no cotizar.
 */

/** Diferencia máxima tolerada entre fuentes para la tasa oficial. */
const MAX_SOURCE_DIVERGENCE = 0.01

/** Salto máximo tolerado contra la última tasa oficial guardada. */
const MAX_DAILY_JUMP = 0.15

export type RateReading = {
  value: number
  /** Fecha valor: el día para el que rige la tasa. */
  valueDate: string
  source: 'bcv' | 'dolarapi'
}

export type FetchResult =
  | {
      ok: true
      rateDate: string
      usdVes: number
      source: string
      /** Falso cuando la tasa ya estaba guardada con ese mismo importe. */
      changed: boolean
      /** Brecha del paralelo sobre el oficial, en fracción. Null si no se obtuvo. */
      gap: number | null
      /** Cierto si una de las dos fuentes no respondió y salvó la otra. */
      partial?: boolean
    }
  | { ok: false; detail: string }

const caracasDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Fecha del negocio para una marca de tiempo.
 *
 * Se convierte a hora de Venezuela antes de quedarse con el día: una lectura a
 * las 02:00 UTC pertenece a la jornada anterior en Caracas, y recortar la
 * cadena ISA la asignaría al día equivocado.
 */
const toBusinessDate = (input: string) => caracasDate.format(new Date(input))

type DolarApiEntry = {
  fuente?: string
  promedio?: number
  venta?: number
  compra?: number
  fechaActualizacion?: string
}

/** Una sola llamada devuelve oficial y paralelo. */
async function fromDolarApi(): Promise<{ oficial: RateReading; paralelo: RateReading | null }> {
  const res = await fetch('https://ve.dolarapi.com/v1/dolares', {
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`dolarapi HTTP ${res.status}`)

  const list = (await res.json()) as DolarApiEntry[]
  if (!Array.isArray(list)) throw new Error('dolarapi: respuesta inesperada')

  const read = (entry: DolarApiEntry | undefined): RateReading | null => {
    if (!entry?.fechaActualizacion) return null
    const value = Number(entry.promedio ?? entry.venta ?? entry.compra)
    if (!Number.isFinite(value) || value <= 0) return null
    return {
      value,
      valueDate: toBusinessDate(entry.fechaActualizacion),
      source: 'dolarapi',
    }
  }

  const oficial = read(list.find((e) => e.fuente === 'oficial'))
  if (!oficial) throw new Error('dolarapi: sin tasa oficial usable')

  return { oficial, paralelo: read(list.find((e) => e.fuente === 'paralelo')) }
}

/**
 * Fuente autoritativa de la tasa oficial.
 *
 * La cadena de certificados de bcv.org.ve no valida, así que se desactiva la
 * verificación TLS **solo para esta petición**. El valor se contrasta después
 * contra la otra fuente, de modo que un intermediario no puede colar una tasa
 * falsa sin que la comprobación de divergencia lo delate.
 */
function fromBcvSite(): Promise<RateReading> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: 'www.bcv.org.ve',
        path: '/',
        rejectUnauthorized: false,
        timeout: 25_000,
        headers: { 'user-agent': 'reserVE/1.0 (+tasa BCV)' },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          const block = body.slice(body.indexOf('id="dolar"'))

          // La cifra vive en <strong class="strong-tb">757,54060000</strong>.
          // La clase cambia entre rediseños, así que no se ancla a ella.
          const amount = block.match(/<strong[^>]*>\s*([\d.]+,\d+)\s*<\/strong>/)
          if (!amount) return reject(new Error('bcv: no se encontró la cifra'))

          // <span ... content="2026-08-10T00:00:00-04:00">Lunes, 10 Agosto 2026</span>
          const dated = block.match(/Fecha Valor:[\s\S]{0,200}?content="([^"]+)"/)
          if (!dated) return reject(new Error('bcv: no se encontró la fecha valor'))

          const value = Number(amount[1].replace(/\./g, '').replace(',', '.'))
          if (!Number.isFinite(value) || value <= 0) {
            return reject(new Error('bcv: cifra ilegible'))
          }

          resolve({ value, valueDate: toBusinessDate(dated[1]), source: 'bcv' })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('bcv: timeout')))
    req.on('error', reject)
  })
}

/**
 * Descarga, valida y guarda las tasas.
 *
 * Idempotente: repetirlo el mismo día actualiza la fila en vez de duplicarla.
 * Ejecutarlo a diario cumple además de latido contra la pausa por inactividad
 * de siete días del plan gratuito de Supabase, así que **debe correr aunque el
 * BCV no haya publicado nada nuevo** (fines de semana y feriados incluidos).
 */
export async function fetchAndStoreRate({ force = false } = {}): Promise<FetchResult> {
  const [apiResult, bcvResult] = await Promise.allSettled([fromDolarApi(), fromBcvSite()])

  const api = apiResult.status === 'fulfilled' ? apiResult.value : null
  const bcv = bcvResult.status === 'fulfilled' ? bcvResult.value : null

  const notes: string[] = [
    api
      ? `dolarapi=${api.oficial.value}@${api.oficial.valueDate}` +
        (api.paralelo ? ` par=${api.paralelo.value}` : ' par=n/d')
      : `dolarapi:${apiResult.status === 'rejected' ? String(apiResult.reason?.message ?? 'error') : 'error'}`,
    bcv
      ? `bcv=${bcv.value}@${bcv.valueDate}`
      : `bcv:${bcvResult.status === 'rejected' ? String(bcvResult.reason?.message ?? 'error') : 'error'}`,
  ]

  const supabase = createAdminClient()

  const fail = async (detail: string): Promise<FetchResult> => {
    await supabase.from('rate_fetch_log').insert({ ok: false, detail })
    return { ok: false, detail }
  }

  if (!api && !bcv) return fail(`ninguna fuente respondió — ${notes.join(' | ')}`)

  /*
    La comprobación de divergencia solo tiene sentido entre cifras de la misma
    fecha valor. dolarapi va una publicación por detrás desde que el BCV cierra
    —sobre las 18:00–20:00 VET— hasta que refresca, y en esa ventana las dos
    fuentes no se contradicen: hablan de días distintos.

    Antes no se notaba porque el único cron corría a las 17:30 VET, con el BCV
    aún abierto y las dos fuentes alineadas. Al sondear cada media hora hasta las
    21:00, la ventana se pisa todas las tardes. Comparando a ciegas, un cierre
    con un movimiento superior al 1 % —los ha habido del 1,66 %— haría fallar
    todos los sondeos de la noche justo cuando hay tasa nueva que recoger.

    Cuando las fechas no coinciden se anota y se sigue: la autoritativa es el
    BCV, y el salto contra lo ya guardado se comprueba igual más abajo.
  */
  if (api && bcv) {
    if (api.oficial.valueDate === bcv.valueDate) {
      const divergence = Math.abs(api.oficial.value - bcv.value) / Math.max(api.oficial.value, bcv.value)
      if (divergence > MAX_SOURCE_DIVERGENCE && !force) {
        return fail(`fuentes divergen ${(divergence * 100).toFixed(2)}% — ${notes.join(' | ')}`)
      }
    } else {
      notes.push('[sin cotejo: fechas valor distintas]')
    }
  }

  // La fuente autoritativa manda cuando responde.
  const oficial = bcv ?? api!.oficial

  const { data: previous } = await supabase
    .from('exchange_rates')
    .select('rate_date, usd_ves')
    .eq('market', 'oficial')
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (previous) {
    const jump = Math.abs(oficial.value - previous.usd_ves) / previous.usd_ves
    if (jump > MAX_DAILY_JUMP && !force) {
      return fail(
        `salto de ${(jump * 100).toFixed(1)}% sobre ${previous.usd_ves} ` +
        `(${previous.rate_date}) — ${notes.join(' | ')}`,
      )
    }
  }

  /*
    ¿Hay que escribir?

    Se compara contra la fila de esa misma fecha valor, no contra la última: si
    ya está guardada con el mismo importe, volver a escribirla no aporta nada y
    solo gasta. Importa porque además del cron diario hay un botón manual, y
    pulsarlo tres veces seguidas no debería dejar tres escrituras idénticas.

    Consecuencia asumida: `fetched_at` pasa a ser «cuándo se vio por primera
    vez» y no «cuándo se confirmó por última vez». Lo segundo lo responde
    `rate_fetch_log`, que sí registra cada intento.
  */
  const { data: sameDay } = await supabase
    .from('exchange_rates')
    .select('usd_ves')
    .eq('market', 'oficial')
    .eq('rate_date', oficial.valueDate)
    .maybeSingle()

  const changed = !sameDay || Number(sameDay.usd_ves) !== oficial.value

  if (changed) {
    const { error } = await supabase.from('exchange_rates').upsert(
      {
        rate_date: oficial.valueDate,
        market: 'oficial',
        usd_ves: oficial.value,
        source: oficial.source,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'rate_date,market' },
    )
    if (error) return fail(`no se pudo guardar la oficial: ${error.message}`)
  }

  // El paralelo es solo métrica: si falla no se aborta nada. Nunca se cobra con
  // él, así que un hueco en la serie no afecta a ninguna reserva.
  let gap: number | null = null
  if (api?.paralelo) {
    const { data: samePar } = await supabase
      .from('exchange_rates')
      .select('usd_ves')
      .eq('market', 'paralelo')
      .eq('rate_date', api.paralelo.valueDate)
      .maybeSingle()

    // El paralelo se mueve a diario, así que casi siempre habrá cambio. La
    // comprobación está por la misma razón: no repetir una escritura idéntica.
    if (!samePar || Number(samePar.usd_ves) !== api.paralelo.value) {
      await supabase.from('exchange_rates').upsert(
        {
          rate_date: api.paralelo.valueDate,
          market: 'paralelo',
          usd_ves: api.paralelo.value,
          source: api.paralelo.source,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'rate_date,market' },
      )
    }
    gap = (api.paralelo.value - oficial.value) / oficial.value
  }

  /*
    El registro distingue tres cosas que antes salían todas como `ok`: que las
    dos fuentes respondieran, que una fallara y salvara la otra, y que la tasa
    ya estuviera guardada. Sin eso, un `ok = true` tapaba que el BCV llevaba
    días sin contestar.
  */
  const partial = !api || !bcv
  await supabase.from('rate_fetch_log').insert({
    ok: true,
    rate_date: oficial.valueDate,
    usd_ves: oficial.value,
    source: oficial.source,
    detail:
      (partial ? '[una fuente falló] ' : '') +
      (changed ? '' : '[sin cambio, no se escribió] ') +
      `${notes.join(' | ')}${gap === null ? '' : ` | brecha=${(gap * 100).toFixed(2)}%`}`,
  })

  return {
    ok: true,
    rateDate: oficial.valueDate,
    usdVes: oficial.value,
    source: oficial.source,
    changed,
    gap,
    partial,
  }
}
