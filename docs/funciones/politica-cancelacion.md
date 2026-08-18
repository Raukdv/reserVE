# Política de cancelación

Hasta cuándo se puede cancelar, cuánto se devuelve, y cómo se garantiza que lo
que el huésped lee sea lo que el servidor le paga.

Es el único texto legal del sitio que además mueve dinero. Todo lo que sigue está
diseñado alrededor de esa frase.

---

## Una política, para todo el negocio

Los tramos viven en `app_settings.cancellation_tiers`, y `app_settings` es una
tabla de **una sola fila**:

```sql
id boolean primary key default true check (id)   -- singleton
```

Así que nunca hubo forma de tener dos políticas a la vez. Durante un tiempo la
interfaz lo sugería —fichas de tramo que se añadían y se quitaban, lo que se lee
como apilar políticas— y se rehízo para que se eligiera **una por nombre**, con
la escalera debajo como consecuencia.

### Las políticas con nombre

`POLICY_PRESETS` en `src/lib/cancellation.ts`:

| Política | Escalones |
|---|---|
| **Flexible** | 100 % hasta 1 día antes |
| **Moderada** | 100 % hasta 5 días antes |
| **Limitada** | 100 % hasta 14 días · 50 % hasta 7 días |
| **Firme** | 100 % hasta 30 días · 50 % hasta 7 días |
| **Personalizada** | La escalera que el operador monte |

Más un escalón implícito al final, que no se configura: **pasado el último
plazo, no hay reembolso**.

Los nombres y los plazos se calcan de Airbnb. Ver [referencias](#referencias).

### Por qué varios escalones, si se elige una sola política

Esta fue una duda razonable —que una escalera de dos o tres pasos fuera rara— y
se investigó antes de tocar el modelo. Resultó al revés: el anfitrión elige
**una** política, pero las dos que más lo protegen son escaleras de tres pasos
(100 % / 50 % / nada). Reducirlo a un único plazo habría dejado «Limitada» y
«Firme» fuera de su alcance.

### Cómo se sabe cuál está puesta

`matchPreset()` compara la escalera **por contenido**, no guarda el nombre:

- Una política creada antes de que existieran los presets se reconoce sola.
- Editar «Firme» hasta convertirla en «Limitada» la reetiqueta sin trucos.
- Cualquier escalera que no coincida con ninguna sale como «Personalizada».

---

## Los dos tipos de tramo

```ts
type CancellationTier =
  | { hours_before: number; kind: 'percent'; refund_percent: number }
  | { hours_before: number; kind: 'nights';  forfeit_nights: number }
```

**`percent`** — un porcentaje del total por noches. Con 100 vuelve todo, cargos
incluidos.

**`nights`** — se cobran las primeras N noches y se devuelve el resto. Es el
«todas las noches menos la primera» de las plataformas.

Los tramos se guardan **en horas** aunque la interfaz se maneje en días: es como
se piensa una política, pero guardar horas permite plazos más finos si algún día
hacen falta.

### Las noches perdidas valen su precio, no un promedio

Cuando el tramo es `nights`, las noches que se retienen se cobran con
`night_price()` —el precio real de cada fecha, temporada incluida— y no
dividiendo el total entre el número de noches.

No es un detalle: en una prueba con temporada alta al principio de la estadía, el
promedio habría devuelto **48 USD de más**.

### El nombre cambia según quién lo lea

`forfeit_nights` está nombrado desde el huésped: son las noches que **no**
recupera. Visto desde el negocio son las que retiene cobradas. Los dos enunciados
describen la misma cantidad, así que:

- La interfaz del operador dice **«Noches que cobras igual»**.
- El texto del huésped dice **«se devuelven todas las noches menos las N
  primeras»**.

---

## Qué pasa con los cargos

Esta es la parte fina, y la que estuvo mal escrita durante un tiempo.

Por debajo del 100 % **no lo decide el tramo, lo decide cada cargo**, con su
casilla `refundable`:

| Tipo de cargo | Qué vuelve |
|---|---|
| De monto, marcado reembolsable | En la misma proporción que las noches conservadas |
| De monto, no reembolsable | Nada, nunca |
| De porcentaje (IVA, tasas) | Sigue a su base |

Con reembolso del 100 % vuelve todo sin distinguir.

**El texto público no nombra la limpieza.** Decía «la limpieza no se reembolsa»,
cableado, y dejó de ser cierto cuando la limpieza pasó de columna a cargo
(migración `0019`): con «Limpieza» marcada como reembolsable, la web prometía al
huésped que **no** la recuperaba mientras el servidor se la devolvía. Ahora dice
lo que de verdad ocurre:

> Los cargos reembolsables vuelven en la misma proporción; los que no lo son, no.

---

## Cómo se garantiza que texto y dinero coincidan

Dos funciones leen **los mismos tramos**:

| | Función | Devuelve |
|---|---|---|
| Dinero | `cancellation_quote()` (Postgres) | Cuánto corresponde devolver |
| Texto | `genericPolicy()` (TypeScript) | Las frases que se publican |

`/legal/cancelacion` **no admite cuerpo libre**. Su contenido lo genera
`genericPolicy()`. Lo único editable es el título y un texto de apoyo, y viven en
`app_settings` junto a los tramos.

Estuvo partido en dos —los tramos en Ajustes, un cuerpo libre en Contenido—
apilados uno debajo del otro sin que nada comprobara que dijeran lo mismo. Nada
impedía prometer allí un reembolso que el servidor no fuera a pagar. La migración
`0021` absorbió ese texto y borró la sección de Contenido.

En el editor de Ajustes hay un bloque **«Así se publica»** con la vista previa
literal, en vivo. Escribir la nota de apoyo sin ver la promesa era la mitad del
problema.

### La página, de arriba abajo

```
h1                    ← título editable, o «Política de cancelación»
• bullets             ← genericPolicy(tramos) — SIEMPRE
  «Los plazos se miden desde las 13:00…»
────── hr ──────      ← solo si hay texto de apoyo
  texto de apoyo      ← prosa libre del operador
```

---

## Tres topes que protegen el cálculo

**Nunca se devuelve más de lo que se pagó.** `refund_usd` es
`least(entitlement, paid)`. Si la política cubre más de lo cobrado, se dice
aparte: *«La política cubre X, pero solo se devuelve lo que llegaste a pagar»* —
el huésped podría esperar la cifra mayor que vio en la escalera.

**Lo que no cubre ningún tramo no se reembolsa.** Si ya venció el último plazo,
`cancellation_quote()` devuelve cero sin más.

**Los plazos se miden desde la hora de entrada**, no desde medianoche.
`check_in_time` de Ajustes, hora de Venezuela. Como el país no aplica horario de
verano, el desfase es constante y se compone directamente.

---

## Qué ve cada uno

| Dónde | Qué |
|---|---|
| `/legal/cancelacion` | La escalera genérica: «hasta 30 días antes…» |
| `/alojamientos/[slug]` | La misma, en la ficha |
| `/reservar/[slug]` | La misma, antes de pagar |
| `/reserva/[code]` | **Con fechas reales**: «antes del 31 de agosto, 1:00 p. m.», el tramo vigente resaltado, y «si cancelas ahora: X USD» |
| `/admin/ajustes` | El editor, con la vista previa |
| Ficha de la reserva en el panel | Lo que tocaría devolver si se cancelara ahora |

La versión genérica obliga al huésped a hacer la cuenta sobre sus propias fechas.
Mostrando el instante límite ya calculado, la pregunta «¿hasta cuándo puedo
cancelar?» se responde sin pensar.

---

## Un fallo que estuvo escondido

**Guardar un tramo por noches fallaba siempre.** El esquema de validación exigía
`refund_percent` en todos los tramos; un tramo `nights` no lo trae, así que
llegaba `NaN`, el esquema fallaba y el operador solo veía *«Revisa los tramos de
cancelación»*.

Reproducido:

```
issue: Expected number, received nan @ 1.refund_percent
```

Toda la función de reembolso parcial —que existe en la base desde la migración
`0016`— era inalcanzable desde la interfaz. Y aunque hubiera pasado, `zod`
descartaba `forfeit_nights` por no estar declarado: el tramo se habría guardado
sin la cifra que lo define.

Corregido con una unión discriminada por `kind`.

---

## Comprobado

Reserva de 10 noches a 20 USD, un cargo reembolsable de 50 y otro no
reembolsable de 30. Contraste entre `cancellation_quote()` y la aritmética que
describe el texto público, en transacción con rollback:

```
tramo «se cobran las 3 primeras noches»
  ok   noches devueltas — 7          ok   cargos devueltos — 35
  ok   total con derecho — 175       ok   el no reembolsable no vuelve — 175
tramo «50 % del total por noches»
  ok   noches devueltas — 100        ok   cargos devueltos — 25
tramo «reembolso completo»
  ok   total con derecho — 280       ok   cargos devueltos — 80
```

Y el reconocimiento de políticas:

```
ok   «Flexible» se reconoce tras ida y vuelta      ok   «Firme» desordenada se reconoce
ok   «Moderada» se reconoce tras ida y vuelta      ok   escalera propia -> personalizada
ok   «Limitada» se reconoce tras ida y vuelta      ok   tramo por noches -> personalizada
ok   «Firme» se reconoce tras ida y vuelta
```

---

## Lo que no cubre

**~~El reembolso no se registra como pago.~~** Resuelto en la migración `0023`:
cancelar congela lo que se debe en `refund_due_usd`, y `staff_record_refund()`
anota cada devolución hecha. Ver `cobro-y-verificacion.md`.

**No hay estado `no_show`.** Al huésped que no aparece solo se le puede cancelar,
con reembolso según política. Pendiente de consultar con operadores reales — ver
`PENDIENTES.md` y `night-audit.md`.

**Los presets no incluyen tramos por noches.** Están disponibles en
«Personalizada», pero ninguna política con nombre los usa.

---

## Referencias

Consultadas en agosto de 2026.

| Fuente | Qué aporta |
|---|---|
| [Cancellation policies for your home — Airbnb](https://www.airbnb.com/help/article/475) | *«Hosts select one cancellation policy per listing… They cannot stack multiple policies.»* Y los escalones exactos de cada política |
| [Airbnb Cancellation Policy 2026: What Replaced Strict — BNBCalc](https://www.bnbcalc.com/blog/airbnb-business/how-to-start-airbnb/airbnb-cancellation-policy-2025-update) | La reconstrucción del 1 de octubre de 2025: «Strict» se retira y migra a «Firme» |
| [Airbnb Host Cancellation Policy: Every Tier Explained — Hostfully](https://www.hostfully.com/blog/airbnb-cancellation-policy/) | Contraste de los tramos entre políticas |
| [Setting up cancellation policies — Booking.com for Partners](https://partner.booking.com/en-us/help/policies-payments/policies/setting-cancellation-policies) | La política se crea y luego se conecta a uno o varios planes de tarifa |
| [Understanding Cancellation Policies — Booking.com Connectivity](https://developers.booking.com/connectivity/docs/policies-api/understanding-cancellation-policy) | Ejemplo de política escalonada: gratis hasta 7 días, 50 % dentro de 7, nada dentro de 24 h |

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Tipos, presets, `matchPreset()`, `genericPolicy()` | `src/lib/cancellation.ts` |
| Editor y vista previa | `src/components/settings-form.tsx` |
| Validación al guardar | `src/app/admin/ajustes/actions.ts` |
| Escalera con fechas reales | `src/components/cancellation-schedule.tsx` |
| Página pública | `src/app/legal/[slug]/page.tsx` |
| Cálculo del reembolso | `cancellation_quote()`, migración `0018` |
| Precio por noche con temporada | `night_price()`, migración `0016` |
| Tramos y horas de entrada/salida | Migración `0015` |
| Dos tipos de tramo | Migración `0016` |
| Cargos en el cálculo | Migración `0018` |
| Texto absorbido desde Contenido | Migración `0021` |

Decisión 8 de `ARCHITECTURE.md`.
