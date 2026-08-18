/**
 * Zona horaria del negocio.
 *
 * **El único literal de zona horaria en TypeScript.** Estaba repetido en cinco
 * sitios —cuatro formateadores de fecha y la política de cancelación— y
 * `BUSINESS_TIMEZONE` prometía controlarla sin que ningún formateador la leyera.
 * Nueve copias del mismo dato entre código y migraciones, y ninguna forma de
 * saber si seguían de acuerdo.
 *
 * Vive aquí y no en `env.ts` porque lo necesitan también componentes de cliente
 * —`settings-form.tsx` importa la política de cancelación— y `serverEnv()` lanza
 * si se ejecuta en el navegador. Un valor que no es secreto y hace falta en las
 * dos mitades no puede vivir detrás de esa puerta.
 *
 * En el servidor `BUSINESS_TIMEZONE` puede sobreescribirlo, y toma este valor
 * por defecto: si nadie define la variable, las dos mitades coinciden por
 * construcción.
 *
 * Postgres guarda su propia copia dentro de `business_today()`, porque una
 * migración no puede leer variables de entorno. Que las dos coincidan lo
 * comprueba `pnpm db:check`, contrastando el día que calcula cada una — que es
 * lo que de verdad importa, más que la igualdad de dos cadenas.
 */
export const BUSINESS_TZ = 'America/Caracas'

/**
 * Desfase fijo de Venezuela sobre UTC.
 *
 * Venezuela no aplica horario de verano, así que es constante y se puede
 * componer directamente en una cadena ISO. Si algún día el negocio operase en
 * otra zona, esto **no** se adapta solo: habría que calcular el desfase de la
 * fecha concreta.
 */
export const BUSINESS_UTC_OFFSET = '-04:00'
