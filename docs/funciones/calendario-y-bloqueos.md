# Calendario y bloqueo de fechas

Quién decide que una fecha está ocupada, y por qué esa decisión no la toma el
código de la aplicación.

Junto con la bandeja de pagos, es la pantalla que define el producto: la que el
operador abre todos los días.

---

## La base impide el doble solape, no el código

Es la restricción más importante del sistema y la única que no se negocia.

```sql
constraint unit_holds_no_overlap exclude using gist (
  unit_id with =,
  stay    with &&
) where (is_active)
```

Reservas y bloqueos comparten la misma tabla `unit_holds`. Dos rangos activos de
la misma unidad no pueden solaparse: el motor lo rechaza con un `23P01` antes de
escribir nada.

**Nunca se sustituye por una comprobación previa.** Entre el «¿está libre?» y el
`INSERT` cabe otra transacción, y en un sistema de reservas esa rendija se
traduce en dos huéspedes en la misma cama la misma noche. Ninguna cantidad de
cuidado en el código cierra esa ventana; un índice GiST sí.

`is_available()` existe y se usa para **avisar antes**, no para decidir:

```sql
select not exists (
  select 1 from unit_holds
  where unit_id = p_unit_id and is_active
    and stay && daterange(p_check_in, p_check_out, '[)')
);
```

Sirve para que el huésped vea «ocupado» sin intentar reservar. Si miente porque
alguien reservó entre medias, el `EXCLUDE` lo corrige.

---

## Los rangos son semiabiertos: `[entrada, salida)`

La noche de salida queda libre. Quien sale el día 10 y quien entra el día 10 no
se solapan, y la restricción lo entiende sin excepciones:

```sql
constraint unit_holds_bounds check (
  lower_inc(stay) and not upper_inc(stay) and not isempty(stay)
)
```

El `check` obliga a que todos los rangos se guarden en esa forma. Sin él, un
rango cerrado por arriba —`[10, 12]`— haría que el día 12 pareciera ocupado y
bloquearía una entrada legítima.

Es también la razón de que una estadía de 5 noches vaya del 1 al 6, no del 1 al
5: se cuentan noches, no días.

---

## Liberar es desactivar, no borrar

```sql
update unit_holds set is_active = false where id = ...
```

El `EXCLUDE` solo mira los activos (`where (is_active)`), así que desactivar
basta para liberar las fechas. Y así se conserva el rastro de qué se canceló,
qué expiró y cuándo — borrar la fila lo perdería.

Lo hacen `staff_cancel_booking()`, `release_block()` y
`expire_stale_bookings()`.

---

## Dos clases de ocupación

`hold_kind` distingue `booking` de `block`. Comparten tabla porque compiten por
el mismo recurso —una noche— y separarlos exigiría comprobar el solape entre dos
tablas, que es exactamente lo que el `EXCLUDE` evita.

**Reserva.** La crea `create_booking()` y arrastra huésped, precio y pagos.

**Bloqueo.** Lo crea `create_block()` y no tiene nada de eso: es «esta unidad no
se alquila estos días». Mantenimiento, uso propio, una reforma. Lleva un motivo
libre.

---

## El calendario del panel

`/admin/calendario`. Timeline de unidades × días: una fila por unidad, una
columna por día, y las estadías como barras que cruzan las columnas.

```
DAYS       = 45   días visibles
DAY_WIDTH  = 28   píxeles por columna, compartido por cabeceras y barras
```

Los dos valores están en una sola constante cada uno porque cabeceras y barras
tienen que cuadrar al píxel: si se desalinean, la barra dice un día distinto del
que marca la cabecera.

### Los colores separan por tono, no por intensidad

| Estado | Color |
|---|---|
| Pendiente de pago | Ámbar |
| Confirmada | Verde `moss` |
| Hospedado | Azul petróleo `tide` |
| Completada | Tinta al 25 % |
| Bloqueo manual | Tinta al 15 % |

`tide` existe exactamente para esto. Dos variantes del mismo verde no se
distinguen en una barra de 28 píxeles, y oscurecer una la haría competir con el
ámbar de «pendiente de pago» — que debe ser el único estado que reclama
atención, porque es el único donde hace falta actuar.

---

## Comprobado

`pnpm db:check` prueba la restricción de verdad, no su existencia:

```
ok   EXCLUDE anti-solape en unit_holds
ok   rechaza solape de fechas
ok   permite check-out y check-in el mismo día
ok   create_booking() rechaza solape
```

Se insertan rangos que se pisan y se comprueba que el motor devuelva `23P01`.
Comprobar que el índice existe no vale: podría existir con la definición
equivocada.

---

## Lo que no cubre

**Las barras se pintan a celda completa.** Los PMS comerciales las desplazan
media columna, de modo que una salida y una entrada el mismo día se ven como dos
triángulos compartiendo el cuadro. Aquí quedan como celdas adyacentes: correcto
respecto al modelo —el rango `[)` deja libre la noche de salida— pero
visualmente sugiere que ese día está ocupado entero.

**No se puede arrastrar sobre la rejilla para bloquear.** Hoy el bloqueo se crea
con un formulario de fechas. Conviene abordarlo junto con lo anterior.

**No hay extensión de estadía.** Si el huésped se queda una noche más no hay
forma de alargar la reserva: habría que crear otra, y el `EXCLUDE` la rechazaría
si esa noche ya está tomada.

**El calendario no señala las estadías vencidas sin cerrar.** Eso sale en el
resumen del panel. Ver `night-audit.md`.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Tabla, restricción y `check` de forma | `unit_holds`, migración `0001` |
| Disponibilidad informativa | `is_available()`, migración `0001` |
| Crear reserva | `create_booking()`, migración `0004` |
| Crear y liberar bloqueos | `create_block()`, `release_block()`, migración `0008` |
| Expiración de pendientes | `expire_stale_bookings()`, migración `0001`; cron en `0005` |
| Timeline del panel | `src/app/admin/calendario/page.tsx` |
| Formulario de bloqueo | `src/components/block-dates.tsx` |
| Calendario público | `src/components/availability-calendar.tsx` |
| Pruebas de la restricción | `scripts/db-check.mjs` |

Decisiones 1 y 2 de `ARCHITECTURE.md`.
