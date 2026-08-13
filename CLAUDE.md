@AGENTS.md

# reserVE

Sistema de reservas por fechas para un alojamiento único en Venezuela.
Next.js + Supabase. Interfaz, comentarios y documentación **en español**.

## Leer antes de tocar nada

| Documento | Qué contiene |
|---|---|
| `docs/ARCHITECTURE.md` | Modelo de datos, decisiones de fondo y su porqué |
| `docs/COSTO-CERO.md` | Restricción de coste. Condiciona qué se puede construir |
| `docs/VARIABLES.md` | Variables de entorno y qué se rompe si falta cada una |
| `docs/PENDIENTES.md` | Acordado pero sin hacer, con contexto suficiente |

## Reglas operativas

Aprendidas a golpes; saltárselas cuesta tiempo.

- **`pnpm`, nunca `npm`.** Está fijado en `packageManager`. Los scripts de
  instalación de dependencias están bloqueados a propósito
  (`pnpm-workspace.yaml`).

- **Compilar con `pnpm run verify`, no `pnpm build`.** `verify` escribe en
  `.next-verify`. Usar `build` mientras el servidor de desarrollo corre le pisa
  los artefactos y rompe la app con *«Failed to read a RSC payload created by a
  development version of React»*.

- **No levantar servidores en el puerto 3000.** Es el del usuario. Para
  comprobaciones, otro puerto y cerrarlo al terminar.

- **Migraciones con `node scripts/apply-migration.mjs <archivo>`.** No hay
  Docker, así que `supabase db push` no sirve. Van en una transacción: entran
  completas o no entran.

- **`src/types/database.ts` está escrito a mano.** `supabase gen types` necesita
  Docker. Al cambiar una migración, actualizar los tipos en el mismo commit —
  incluidas las `Relationships`, sin las cuales los embeds de PostgREST fallan.

- **`pnpm db:check` después de tocar el esquema.** Verifica tablas, funciones,
  RLS y prueba de verdad la restricción anti-solape.

- **`pnpm env:check` ante cualquier fallo raro de integración.** Valida formato y
  longitud de secretos; un `whsec_` truncado costó horas.

## Restricciones que no se negocian

- **La base impide el doble solape**, no el código. Reservas y bloqueos comparten
  `unit_holds` con un `EXCLUDE USING gist`. Nunca sustituir eso por una
  comprobación previa: entre el «¿está libre?» y el `INSERT` cabe otra
  transacción.

- **Rangos de fecha semiabiertos `[entrada, salida)`.** La noche de salida queda
  libre.

- **Solo la tasa oficial del BCV para cobrar.** La Ley de Precios Justos lo
  exige. El paralelo se registra únicamente como métrica de brecha;
  `current_rate()` lo ignora.

- **El precio lo calcula el servidor.** `quote_stay()` es la autoridad; ningún
  total que llegue del cliente se usa.

- **El reporte manual de comprobante es el camino principal**, no un parche. Así
  se cobra en Venezuela, y seguirá existiendo aunque entren pasarelas.

- **Toda lista lleva tope.** Renderizar sin límite quema el presupuesto de CPU
  del plan Hobby.
