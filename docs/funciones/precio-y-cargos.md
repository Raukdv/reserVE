# Precio y cargos

Cómo se forma lo que paga el huésped, quién lo decide, y por qué el total y el
ingreso no son la misma cifra.

Para **cómo entra ese dinero** y cómo se comprueba, ver `cobro-y-verificacion.md`.
Para **la conversión a bolívares**, `tasa-bcv-y-bimoneda.md`.

---

## El precio lo calcula el servidor

`quote_stay()` es la autoridad. Ningún total que llegue del cliente se usa —ni
para mostrar, ni para cobrar, ni para comparar.

No es desconfianza hacia el navegador: es que **hay dos clientes** —la web
pública y el panel— y en cuanto el cálculo se duplica, divergen. Un cargo nuevo
entra en uno y no en el otro, y la diferencia aparece meses después en una
factura que no cuadra.

La misma función responde al huésped que cotiza, al operador que crea una reserva
a mano y a `create_booking()` cuando la confirma. Tres caminos, un cálculo.

---

## Noche a noche, no noches por precio

El subtotal no es `precio × noches`. Se recorre cada noche por separado:

```sql
for v_night in select generate_series(p_check_in, p_check_out - 1, '1 day')
loop
  select price_usd, min_nights from season_rates
   where unit_id = p_unit_id and period @> v_night;

  v_subtotal := v_subtotal + coalesce(v_price, v_unit.base_price_usd);
end loop;
```

`generate_series` llega hasta `check_out - 1` porque el rango es semiabierto: la
noche de salida no se cobra. Ver `calendario-y-bloqueos.md`.

Cada noche busca su tarifa en `season_rates`, y si ninguna temporada la cubre cae
en `units.base_price_usd`. Así una estadía que cruza de temporada baja a alta se
cobra bien sin que nadie tenga que partirla: las noches de cada lado llevan su
precio.

`season_rates` tiene su propio `EXCLUDE USING gist (unit_id, period)`, igual que
las reservas. Dos temporadas solapadas para la misma unidad harían la consulta no
determinista —qué precio sale dependería del plan de ejecución— así que la base
lo impide en vez de confiar en el formulario.

### El mínimo de noches es el mayor de los que toca

```sql
v_min_req := greatest(v_min_req, coalesce(v_night_min, v_unit.min_nights));
```

Una temporada puede exigir más noches que la unidad —Semana Santa con mínimo de
tres— y si la estadía la roza, ese mínimo manda. Se acumula con `greatest` en el
mismo recorrido, así que basta tocar una noche de temporada alta para que su
mínimo aplique. Es deliberado: es justo lo que evita que alguien reserve la noche
del sábado suelta en el fin de semana más caro del año.

---

## Los cargos: cuatro formas, dos alcances

| Forma | Cómo se calcula |
|---|---|
| `fixed` | Una vez por estadía |
| `per_night` | × noches |
| `per_guest` | × huéspedes |
| `percent` | Sobre la base ya formada |

Y dos alcances: `unit_id` nulo es **general**, a todas las unidades —IVA, tasa
turística—; con valor es **de esa unidad** —limpieza, piscina, traslado—.

### Por qué los porcentajes van en una segunda pasada

`compute_fees()` recorre los cargos dos veces. Primero los de monto, que se suman
al subtotal y forman la base; después los porcentajes sobre esa base ya cerrada.

Al revés, el IVA no gravaría la limpieza. Y el IVA **sí** grava el valor del
servicio completo, no solo el alojamiento.

**Un porcentaje no grava a otro porcentaje.** Todos usan la misma base, la del
final de la primera pasada. Para el IVA sobre la limpieza está bien. Si algún día
se crea un «recargo de temporada alta» como porcentaje, el IVA no caerá sobre él
—y probablemente debería—. Se deja así porque cambiarlo cambiaría lo que se
cobra, que no es una decisión de refactor.

### Reembolsable no es lo mismo para un porcentaje

Un cargo de monto lleva su bandera `refundable`: la limpieza no vuelve una vez
que el equipo se preparó, un depósito sí.

Un porcentaje no tiene bandera propia, se guarda siempre como `refundable: true`.
No es una excepción: es que **un porcentaje sigue a su base**. Si se devuelve la
mitad de la estadía, se devuelve la mitad del IVA, sin que nadie lo decida. La
bandera no le aplica porque la respuesta ya está determinada.

---

## Los impuestos están apagados, y es lo correcto

**Por defecto el sistema no aplica IVA.** `app_settings.vat_enabled` viene en
falso, y mientras lo esté, los cargos marcados como impuesto no se calculan, no
se cobran y no aparecen en el desglose.

No es prudencia excesiva. Cobrar IVA no es calcular un porcentaje: obliga a
emitir factura fiscal con correlativo, llevar libro de ventas y poder emitir
notas de crédito cuando se devuelve dinero. **Nada de eso existe aquí, y no está
previsto que exista** — la facturación saldría de otro sistema y esta aplicación,
como mucho, referenciaría lo que aquel emita.

Con el IVA aplicándose de frente y sin ese respaldo, el sistema asumía una
responsabilidad que no podía cumplir:

- Devolvía el impuesto al huésped sin poder recuperarlo del SENIAT, porque
  recuperarlo exige la nota de crédito que no se puede emitir. En una cancelación
  total de una reserva de 301,60 eran **41,60 de pérdida real**.
- Retenía impuesto sobre penalizaciones y no-shows, que según todo lo encontrado
  son indemnizaciones no sujetas. Ver `PENDIENTES.md`.

Apagado, nada de eso ocurre. **El operador decide cómo compone el total**, que es
cosa suya y de su contabilidad; el sistema cobra lo que se le diga y no pretende
saber de impuestos.

```
vat_enabled=false  → Limpieza              total 260.00  tax 0     net 260
vat_enabled=true   → Limpieza, IVA         total 301.60  tax 41.60 net 260
```

El filtro se aplica en las dos pasadas de `compute_fees()`, no al final. Un
impuesto excluido tampoco debe engordar la base de los porcentajes.

**Lo ya cobrado no cambia.** El desglose vive congelado en la reserva: una
cobrada con IVA lo conserva y se devuelve como siempre. El interruptor gobierna
lo que se cotiza de aquí en adelante.

La marca `is_tax` se conserva aunque esté apagado, así que encenderlo no obliga a
reconfigurar nada. El editor de cargos avisa cuando un cargo está marcado como
impuesto y no se está aplicando — sin eso se ve activo y configurado, y el
operador puede pasarse semanas creyendo que lo cobra.

### Y cuando se encienda

El IVA se cobra al huésped, se recauda por cuenta del fisco y se entera. Contarlo
como ingreso infla la cifra en la proporción exacta del tipo impositivo: con el
16 % venezolano, casi una séptima parte de lo que una gráfica diría que se ganó.

Hasta la migración `0035` la tabla no tenía forma de decirlo. Un cargo `percent`
llamado «IVA» y otro llamado «Recargo de temporada alta» eran indistinguibles
para el código, y el segundo sí es ingreso.

`fees.is_tax` lo marca, y la cotización devuelve tres cifras donde había una:

```
total_usd  301.60   ← lo que paga el huésped
tax_usd     41.60   ← se entera al fisco
net_usd    260.00   ← ingreso del negocio
```

**Al huésped no le cambia nada.** El anticipo se sigue calculando sobre el total
con impuestos —artículo 13 de la Ley del IVA, ver `cobro-y-verificacion.md`— y
las devoluciones siguen devolviendo la parte proporcional. Esto es cómo se
cuenta, no cómo se cobra.

### Por qué una bandera propia y no `refundable`

Son preguntas distintas y no correlacionan:

- `refundable` — ¿vuelve este dinero al huésped?
- `is_tax` — ¿es este dinero del negocio?

Un impuesto **sí** vuelve si se devuelve la estadía, porque el hecho imponible se
deshace. Y aun así nunca fue dinero del negocio. Un cargo puede ser cualquiera de
las cuatro combinaciones.

### El IGTF va por otro camino

No es un cargo y no pasa por aquí. Grava el pago, no la estadía, y solo si se
paga en divisas —cosa que al cotizar todavía no se sabe—. Vive en
`payments.igtf_usd`, fuera de `amount_usd`. La cotización lo enseña como
proyección (`total_divisas_usd`), no como parte del precio. Ver `cobro-y-verificacion.md`.

---

## El desglose se congela con la reserva

`bookings.fees_breakdown` guarda la lista completa tal como se calculó: nombre,
forma, tarifa, importe, si era reembolsable, si era impuesto.

No es duplicación. Consultar la tabla `fees` seis meses después diría cómo está
configurado el cargo **hoy**, no cómo se cobró entonces. Una reserva de enero
tiene que poder explicar su propia factura aunque el IVA haya cambiado, la
limpieza haya subido o el cargo se haya borrado.

Por eso `is_tax` va dentro del JSON y no se resuelve por `id` al leerlo. Los
desgloses anteriores a la `0035` no llevan la marca; `parseAppliedFees()` los
cuenta como ingreso, que es exactamente lo que se asumía cuando se congelaron.

---

## Qué responde cuando no se puede cotizar

`quote_stay()` nunca lanza excepción. Devuelve `{ok: false, error: …}` y quien
llama decide cómo contarlo:

| Error | Significa |
|---|---|
| `unit_not_found` | La unidad no existe |
| `invalid_dates` | Salida anterior o igual a la entrada |
| `too_many_guests` | Pasa de `max_guests` |
| `too_soon` | No respeta `advance_notice_days` |
| `below_min_nights` | Menos noches que el mínimo, que viene con la respuesta |
| `above_max_nights` | Más noches que `max_nights` |
| `unavailable` | Las fechas están tomadas |
| `stale_rate` | La tasa BCV lleva más de tres días |

`stale_rate` es el que sorprende: se prefiere **no cotizar** a cotizar con una
tasa vieja. Cobrar mal en bolívares es a la vez un error y un incumplimiento de
la Ley de Precios Justos. Ver `tasa-bcv-y-bimoneda.md`.

El operador puede saltarse dos comprobaciones con `p_skip_notice` —el aviso
previo y el mínimo de noches— porque son políticas comerciales, no reglas
físicas: por teléfono se negocian. La disponibilidad y la tasa no se saltan.

---

## Comprobado

`pnpm db:check` prueba de verdad, contra la base:

```
ok   quote_stay() responde
ok   el impuesto sale del ingreso — total 174 = neto 150 + impuesto 24
ok   el desglose dice cuál cargo es impuesto
ok   rechaza cotizar con tasa rancia
```

La prueba de impuestos inserta un cargo del 16 % y lo deshace en un savepoint. No
es adorno: el archivo entero corre en una transacción, y un `begin` anidado en
vez de un savepoint llegó a borrar las tasas oficiales de producción. Cada bloque
que escribe va en el suyo.

---

## Lo que no cubre

**No hay descuentos calculados.** `bookings.discount_usd` existe y se resta del
total, pero lo pone el operador a mano. No hay códigos promocionales, ni
descuento por estadía larga, ni por reserva anticipada.

**Un porcentaje no grava a otro.** Explicado arriba. Queda anotado por si algún
día se crea un recargo como porcentaje.

**No hay precio por número de huéspedes.** `per_guest` cubre un cargo por
huésped, pero la tarifa de la noche es la misma para dos que para cuatro. Un
suplemento por huésped adicional a partir del tercero no tiene forma de
expresarse hoy.

**La sección de ganancias no existe todavía.** Los datos ya están separados
—`tax_usd` y `net_usd`—, falta dibujarla. Ver la observación 4 de `DISENO.md`.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Cotización, la autoridad | `quote_stay()`, migración `0035` |
| Cargos y su desglose | `compute_fees()`, migraciones `0017` y `0035` |
| Tabla de cargos | `fees`, migraciones `0017` y `0035` |
| Tarifas por temporada | `season_rates`, con su `EXCLUDE` |
| Desglose congelado | `bookings.fees_breakdown` |
| Formas y etiquetas en la app | `src/lib/fees.ts` |
| Editor del panel | `src/components/fees-editor.tsx`, `/admin/cargos` |
| Temporadas en el panel | `/admin/tarifas` |
