# Pendientes

Cambios acordados pero no aplicados todavía, con el contexto necesario para
hacerlos sin volver a preguntar. Se borran de aquí al implementarse.

Algunas entradas no son código sino **consultas informativas**: preguntas que
hay que hacerle a alguien que opera de verdad antes de decidir. Van marcadas
como tales, porque implementarlas sin la respuesta es adivinar.

---

## Auditoría nocturna completa — más allá del no-show

**Resuelto lo pequeño, anotado lo grande.**

La consulta a operadores está cerrada: **al que no aparece no se le devuelve
nada**. De ahí salieron las migraciones `0031` y `0032` — estado `no_show` propio
y `staff_mark_no_show()`, que fija `refund_due_usd = 0` explícitamente en vez de
pasar por `cancellation_quote()`. Lo cobrado se queda. Ver
`docs/funciones/night-audit.md`.

### Lo que queda anotado

Al responder salió algo que no estaba en el planteamiento: **`no_show` no es una
funcionalidad suelta, es un estado dentro de un proceso mayor**. La auditoría
nocturna de un alojamiento real, la que se hace de madrugada antes de abrir el
día siguiente, abarca bastante más:

- **Las habitaciones**, que es lo único que hoy cubrimos: quién no llegó, quién
  se fue sin avisar, qué estadía venció sin cerrarse.
- **El dinero.** Cuadre de lo cobrado contra lo registrado. En un sitio que cobra
  por transferencia, efectivo en dos monedas y punto de venta, esto es el grueso
  del trabajo.
- **El cierre de cajas.** Cuánto había al abrir, cuánto al cerrar, quién lo contó.
- **La preparación del día siguiente.** Llegadas previstas, habitaciones a
  preparar, cobros pendientes que vencen.

Nada de esto está construido y no hace falta que lo esté para operar. Se anota
porque la pieza que sí hicimos encaja dentro de este marco, y cuando llegue el
momento de un cierre diario de verdad conviene saber que `no_show` era una
esquina de algo más grande, no una funcionalidad terminada.

Condiciona además la sección de ganancias pendiente: un cierre de caja y un
informe de ingresos leen de las mismas cifras.

---

## Devolver el `matcher` del middleware al abrir al público

La puerta de acceso queda **decidida y en uso** — probada en local, variable ya
definida en Vercel. Su funcionamiento está documentado en `VARIABLES.md`.

Lo único pendiente es el resto que deja al retirarla. El `matcher` de
`src/middleware.ts` se amplió a todas las rutas para que la puerta cubriera el
sitio entero; con `SITE_PASSWORD` fuera, el middleware sigue corriendo en cada
visita pública sin hacer nada útil.

Devolverlo a:

```ts
matcher: ['/admin/:path*']
```

Es una invocación por visita, y el plan Hobby incluye 1.000.000 al mes. Con el
sitio privado no se nota; con tráfico real, sí. Ver `docs/COSTO-CERO.md`,
regla 3.3.

---

## ~~`BUSINESS_TIMEZONE` — conectada a medias~~ — resuelto en TypeScript

Estaba declarada sin que ningún código la leyera, y la zona aparecía literal en
**nueve sitios** entre código y migraciones.

Ahora en TypeScript hay **un solo literal**, en `src/lib/timezone.ts`. De ahí
salen los cuatro formateadores de fecha, la política de cancelación y el valor
por defecto de `BUSINESS_TIMEZONE` — así que si nadie define la variable, las dos
mitades coinciden por construcción.

Vive ahí y no en `env.ts` porque lo necesitan también componentes de cliente
—`settings-form.tsx` importa la política de cancelación— y `serverEnv()` lanza si
corre en el navegador.

**Postgres conserva su copia** dentro de `business_today()`, y no puede ser de
otra forma: una migración no lee variables de entorno. Lo que sí hay ahora es una
comprobación en `pnpm db:check` de que las dos calculan el mismo día:

```
ok   Postgres y la app coinciden en el día del negocio — base 2026-08-18 · app 2026-08-18
```

Se compara el **resultado**, no la cadena de configuración: un desacuerdo de zona
no aparece como error sino como una tasa que entra en vigor antes de tiempo o
unas llegadas adelantadas un día.

Lo que queda abierto, y solo importa si el negocio dejara de estar en Venezuela:

- `properties.timezone` existe con valor por defecto y **nadie lo lee**. O se
  conecta o se quita — hoy promete algo que no cumple.
- `BUSINESS_UTC_OFFSET` da por hecho que no hay horario de verano, cosa cierta en
  Venezuela pero no en general.
- Las tres funciones de cancelación en las migraciones `0015`, `0016` y `0018`
  llevan el literal dentro.

---

## ~~Revisar el flujo de cobro con el modelo de cargos ya puesto~~ — cerrado

Los cargos —generales y por unidad, con porcentajes sobre base— entraron después
de que el cobro estuviera construido, y este repaso quedaba pendiente. Los cuatro
puntos están resueltos; se conservan porque documentan **por qué** cada uno quedó
como quedó.

- ~~**Reembolsos.**~~ Resuelto en la migración `0023`: cancelar congela lo que se
  debe en `refund_due_usd`, y `staff_record_refund()` anota cada devolución hecha
  con su canal, referencia y nota. La app sigue sin mover el dinero —eso se hace
  en Stripe o en el banco— pero ya queda constancia de que salió. Ver
  `docs/funciones/cobro-y-verificacion.md`.
- ~~**Anticipo sobre qué base.**~~ Revisado: se queda sobre el total con cargos.
  El artículo 13 de la Ley del IVA hace que cobrar un anticipo ya cause el
  impuesto, así que excluirlo obligaría al negocio a adelantarlo de su bolsillo.
  Coincide además con Booking y Opera. Ver
  `docs/funciones/cobro-y-verificacion.md`.
- ~~**IGTF.**~~ Resuelto en la migración `0024`, y no como un cargo: lo grava el
  medio de pago, no la estadía, así que vive en `payments.igtf_usd` y se calcula
  al cobrar. La cotización solo lo proyecta. Ver
  `docs/funciones/cobro-y-verificacion.md`.
- ~~**`units.cleaning_fee_usd`.**~~ Retirada en la migración `0019`.

---

## Webhook de Stripe en producción

**Pendiente para el próximo día de trabajo.**

El primer despliegue va **sin pasarela de pago**, solo para comprobar que la app
corre en Vercel. Sin `STRIPE_SECRET_KEY` la sección «Pagar con tarjeta»
sencillamente no aparece y el resto funciona igual: el reporte manual de
comprobante es el camino principal y no depende de Stripe.

Cuando toque activarla:

1. **Crear el destino en Stripe.** Dashboard → Developers → Webhooks → Add
   destination.
   - URL: `https://reserve.lngeneralservices.com/api/webhooks/stripe`
   - Evento: `checkout.session.completed`

2. **Copiar su secreto de firma.** Es un `whsec_` **distinto** del que hay en
   `.env.local`: ese pertenece al listener local de la CLI. Cada endpoint firma
   con el suyo, y usar el equivocado devuelve 400 en todos los eventos.

3. **Definir en Vercel** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.

4. **Comprobar la longitud** antes de dar nada por bueno: el cuerpo del `whsec_`
   son 64 caracteres hexadecimales. Un pegado al que le falta uno mantiene el
   prefijo correcto y cuesta horas encontrarlo. `pnpm env:check` lo detecta en
   local; en Vercel hay que contarlo a mano o volver a copiarlo con cuidado.

5. **Probar con una reserva real** y `4242 4242 4242 4242` mientras la clave siga
   siendo `sk_test_`. Si el webhook no llega, `pnpm stripe:reconcile` recupera el
   cobro.

Recordatorio de fondo: activar cobros **reales** exige una entidad legal en un
país soportado por Stripe, y Venezuela no lo está. Ver `docs/ARCHITECTURE.md`.

---

## ~~Tipo de documento de identidad~~ — hecho el 2026-08-10

Implementado en `src/lib/document.ts` y `src/components/document-input.tsx`, con
validación de servidor en los cuatro formularios. Se conserva la especificación
abajo porque documenta **por qué** se valida lo que se valida.

---

## Tipo de documento de identidad

Hoy el documento es un campo de texto libre donde el huésped escribe
`V-27866046` a mano. Debe pasar a **selector de tipo + campo de número**.

Tipos que se usan en Venezuela:

| Prefijo | Significado |
|---|---|
| `V` | Venezolano — cédula de identidad |
| `E` | Extranjero — cédula de identidad para residentes legales |
| `J` | RIF jurídico — empresas |
| `P` | Pasaporte |

### Dónde aparece

| Sitio | Campo |
|---|---|
| `/reservar/[slug]` → `booking-form.tsx` | `document` → `bookings.guest_document` |
| `payment-report-form.tsx` | `payerDocument` → `payments.payer_document` |
| `/admin/ajustes` → `payment-accounts.tsx` | `document` → `payment_accounts.document` |
| Perfiles | `profiles.document_id` |

### Cómo guardarlo

Mantener **una sola columna de texto** con el valor compuesto (`V-27866046`).
No hace falta migración: lo que cambia es cómo se arma en la interfaz. Partirlo
en dos columnas obligaría a tocar cuatro tablas y las plantillas de correo, a
cambio de nada — nunca se filtra ni se agrupa por tipo de documento.

La composición y el troceo deben vivir en un solo sitio, junto a `usd()` y
`ves()` en `src/lib/format.ts`, para que los tres formularios no diverjan:

```ts
export type DocumentType = 'V' | 'E' | 'J' | 'P'
export const composeDocument = (type: DocumentType, number: string) => …
export const parseDocument = (value: string | null) => …  // para precargar al editar
```

### Validación — obligatoria, y solo donde hay estándar real

Se validó qué es comprobable de verdad. **De los cuatro tipos, solo el RIF tiene
algoritmo**; el resto son formato y longitud. Inventar reglas más estrictas
rechazaría documentos legítimos y costaría reservas.

#### `V` y `E` — cédula de identidad

Es un número correlativo **sin dígito verificador**. No existe nada que
comprobar más allá del formato.

- Solo dígitos, 5 a 9. Se normaliza quitando puntos y espacios.
- Aceptar opcionalmente un dígito verificador final (`V-12345678-9`): en ese caso
  es un **RIF personal**, no una cédula, y se valida con el algoritmo de abajo.

#### `J` — RIF jurídico

Único con verificación real. Algoritmo del SENIAT, módulo 11:

```
Valor del prefijo:  V=1  E=2  J=3  P=4  G=5
Pesos:              4 3 2 7 6 5 4 3 2

suma = prefijo*4 + d1*3 + d2*2 + d3*7 + d4*6 + d5*5 + d6*4 + d7*3 + d8*2
resto = suma % 11
verificador = 11 - resto        // si da 10 u 11 → 0
```

- Formato `J-12345678-9`: 8 dígitos más el verificador.
- Se admite escrito con o sin guiones y se normaliza.
- Si el verificador no cuadra, el mensaje debe ser «el RIF no parece correcto,
  revisa los dígitos» — es un error de tecleo, no una acusación.

#### `P` — pasaporte

No hay estándar de contenido. ICAO Doc 9303 define el formato de la zona de
lectura mecánica, no el número en sí: cada país emisor lo asigna a su manera. La
ranura de la MRZ admite hasta 9 caracteres alfanuméricos, pero **los números más
largos se desbordan al campo opcional**, así que limitar a 9 rechazaría
pasaportes válidos.

- Alfanumérico `A–Z` y `0–9`, 5 a 20 caracteres, en mayúsculas.
- Sin dígito verificador: el de la MRZ se calcula sobre la zona impresa a máquina,
  no forma parte del número que el huésped teclea.

Por defecto `V`, que es el caso mayoritario.

### Contexto por formulario

- Checkout y reporte de pago identifican a una **persona** → por defecto `V`.
- Cuentas de cobro en ajustes identifican al **negocio** → por defecto `J`, donde
  la verificación del dígito sí aplica siempre.

---

## Ayuda de porcentaje en `format.ts`

El `* 100` para mostrar fracciones como porcentaje está suelto en cuatro sitios
—checkout, ficha del alojamiento, página del huésped y listado—. Es solo
presentación, así que no hay riesgo de cobrar mal, pero conviene un `percent()`
junto a `usd()` y `ves()`.

Recordatorio de por qué la base guarda fracción y la interfaz muestra porcentaje:
en la base es un multiplicador (`total_usd * deposit_ratio`) y la restricción
`<= 1` es una invariante limpia; en pantalla el operador piensa en «30%», y un
campo que espera `0.3` invita a escribir `30` y confirmar un 3000%.

---

## ~~Barras a media celda en el calendario del panel~~ — hecho

Las estadías se dibujan desplazadas media columna, así que el día en que uno sale
y otro entra se ve como dos mitades compartiendo el cuadro. El ancho no cambió:
sigue siendo una columna por noche.

Eso obligó a sacar las barras del flujo de celdas —con el desplazamiento, media
celda pertenece a una estadía y media a la siguiente— y la rejilla pasó a ser
componente cliente. Con esa estructura ya puesta entró también **arrastrar sobre
los días libres para bloquearlos**, que se abordaba junto.

Ver `docs/funciones/calendario-y-bloqueos.md`.

---

## Bloquear fechas desde el móvil

El arrastre sobre la rejilla es **solo de ratón**: se apoya en `mousedown`,
`mouseenter` y `mouseup`. En una pantalla táctil no hay `mouseenter`, y arrastrar
el dedo sobre una zona que además hace scroll horizontal pelea con el gesto del
navegador. Hoy en móvil solo queda el formulario de fechas de siempre.

### Cómo se resuelve: dos toques, no arrastre

Un botón que entra en **modo selección**, y dentro de ese modo:

1. Toque en una casilla libre → marca el inicio.
2. Toque en otra → marca el fin y abre la confirmación de siempre.

Un tercer toque antes de confirmar mueve el extremo en lugar de empezar de cero:
con el dedo se falla la casilla más de lo que se cree, y obligar a reiniciar la
selección por un día de diferencia es lo que hace abandonar.

### Por qué así y no imitando el arrastre

Reproducir el arrastre con `touchmove` obliga a `preventDefault` sobre el
contenedor, y eso mata el scroll horizontal — que en una rejilla de 45 días es
justo lo que hace falta para llegar a la fecha. Dos toques discretos conviven con
el scroll sin pelearse.

Además el modo explícito evita el problema contrario: en táctil no hay diferencia
entre «toco para seleccionar» y «toco para abrir la reserva», y sin un modo que
lo separe cualquier toque sería ambiguo.

### Al implementarlo

- El estado de selección ya existe en `CalendarGrid` (`drag` con `a` y `b`); lo
  que cambia es cómo se alimenta, no lo que produce. La confirmación y la acción
  de bloqueo se reutilizan tal cual.
- El botón de modo solo tiene sentido donde no hay puntero fino. Se puede mostrar
  siempre —no estorba en escritorio y da una alternativa por si el arrastre se
  atasca— o condicionarlo a `(pointer: coarse)`.
- Marcar visualmente el extremo ya elegido mientras se espera el segundo toque:
  sin eso el modo selección no se distingue del normal.
- Salir del modo con el mismo botón, y también al confirmar o cancelar.

Esto tampoco cubre el teclado, que sigue sin equivalente.

---

## Separar los impuestos de los ingresos

**Bloquea la sección de ganancias.** Ver la observación 4 de `DISENO.md`.

El IVA no es del negocio. Se cobra al huésped, se recauda por cuenta del fisco y
se entera — igual que el IGTF. Contarlo como ingreso infla la cifra en la
proporción exacta del tipo impositivo.

### El problema

La tabla `fees` no tiene forma de decirlo. Un cargo `percent` llamado «IVA» y
otro llamado «Recargo de temporada alta» son indistinguibles para el código:

```sql
kind = 'percent'   -- ¿tributo que enteras, o recargo que te quedas?
```

El segundo sí es ingreso. El primero no. Y cualquier gráfica que sume
`total_usd` o `fees_usd` los mete en el mismo saco.

El IGTF no tiene este problema porque nunca fue un cargo: vive en
`payments.igtf_usd` y ya está fuera de `amount_usd` desde la migración `0024`.
El IVA sí es un cargo, y ahí se mezcla.

### Qué hay que decidir

**1. Cómo se marca.** Una columna `fees.is_tax boolean`, o equivalente. No sirve
reutilizar `refundable`: son cosas distintas y un impuesto **sí** se devuelve al
huésped si se le devuelve la estadía, que es como funciona hoy.

**2. Qué pasa con lo ya cobrado.** El desglose está congelado en
`bookings.fees_breakdown` sin esa marca. O se migran las filas existentes
mirando el `id` del cargo, o la cifra histórica queda sin separar y se dice.

**3. Cómo se muestra.** Tres caminos, y conviene elegir antes de dibujar:

- **No mostrarlo.** La gráfica enseña solo el ingreso neto. Honesto y simple,
  pero el operador pierde de vista un dinero que **tiene que declarar y pagar**.
- **Como banda restada** dentro de la barra del mes. Se ve de dónde sale la
  diferencia, pero la barra deja de leerse de un vistazo, que era el objetivo.
- **Como cifra aparte** — «impuestos recaudados este mes» —, con la gráfica
  mostrando solo lo neto.

Lo tercero es lo que recomendaría: la barra dice lo que ganaste, y al lado está
lo que debes enterar. Son dos preguntas distintas y mezclarlas en una forma hace
que ninguna se responda bien.

### Lo que no cambia

Nada del cobro ni del reembolso. Al huésped se le sigue cobrando lo mismo, el
anticipo se sigue calculando sobre el total con impuestos —ver el artículo 13 de
la Ley del IVA en `cobro-y-verificacion.md`— y las devoluciones siguen
devolviendo la parte proporcional del impuesto. Esto es solo **cómo se cuenta**,
no cómo se cobra.

---

## Vigilar — el BCV devuelve datos distintos entre llamadas

**Observado el 2026-08-18.** En cuatro consultas seguidas, con segundos entre
ellas, la fuente autoritativa alternó entre dos respuestas:

```
bcv=775.3356@2026-08-19
bcv=773.3125@2026-08-18   ←
bcv=773.3125@2026-08-18
bcv=775.3356@2026-08-19   ←
```

Las dos son plausibles —una rige hoy y la otra mañana— y la app las guardó
ambas, así que nada se rompió. Pero significa que **cuál se guarda depende de a
qué nodo caiga la petición**, y eso no es determinista.

Probablemente una caché o un balanceador desincronizado en su lado. Hace falta
observarlo varios días antes de decidir nada: puede haber sido puntual de esa
tarde, justo cuando publican.

Si resulta constante, las salidas son:

- **Consultar dos veces y quedarse con la fecha valor mayor**, que es la que
  acabará rigiendo de todas formas. Cuesta una petición extra por corrida.
- **Preferir `dolarapi` cuando discrepen en fecha**, no en importe. Hoy manda el
  BCV siempre que responda, por ser la fuente autoritativa.

No tocar sin datos. El guardia de divergencia y el de salto diario ya impiden que
una lectura absurda entre.

---

## Comprobar el registro contra lo que se fuerza

Cada consulta manual deja una línea en `rate_fetch_log`, pero **nadie las
contrasta con lo que acabó en `exchange_rates`**. Con el botón de actualizar eso
pasa a importar: si alguien lo pulsa varias veces, el registro dirá cuatro
intentos y la tabla puede tener una fila, dos o ninguna nueva.

Falta una comprobación que responda: de lo que dice el registro que se leyó,
¿qué se guardó de verdad y qué se descartó por no haber cambiado?

Encaja en `pnpm db:check`, junto a las tres pruebas de tasa que ya hay. Contrastar
la última línea del registro con la fila de esa fecha valor y avisar si el
importe no coincide — sería la señal de que algo escribió por otro camino.

---

## Menor — pulir el giro del cuaderno

Funciona y se ve bien, pero queda como candidato a retoque. No corre prisa.

Estado actual, en `src/components/units-book.tsx` y `globals.css`:

- Giro de 600 ms, `cubic-bezier(.4,.05,.2,1)`. La duración es **un solo número**,
  `FLIP_MS`, del que dependen también las tres animaciones de luz.
- La cara de delante se oscurece al ponerse de canto; el reverso aparece en
  sombra y se aclara. Las dos fijan su valor en el 50 % para que el relevo entre
  caras no dé un salto de brillo.
- Sombra proyectada sobre el pliego mientras la hoja pasa por encima.
- El degradado va más oscuro junto al lomo, invertido en el reverso porque está
  espejado.

Lo que se probó y se descartó de momento: bajar los milisegundos. El problema no
era el ritmo sino que faltaba la luz, y con ella el giro ya se lee como papel.

Si se retoma, lo siguiente sería **curvar la hoja** — un pandeo a media vuelta,
que es lo que hace el papel de verdad. Pide `transform` sobre pseudo-elementos y
complica bastante el componente, así que solo compensa si el giro plano llega a
molestar.

Por debajo de 450 ms el giro deja de leerse como papel y parece un corte.

---

## Medir cuánto pesan de verdad las fotos

Los topes de `src/lib/media-limits.ts` —400 KB por foto, 40 por unidad— salen de
aritmética sobre los límites del plan gratuito, no de uso real. Con una sola foto
subida el dato disponible es anecdótico: 218 KB, en la mitad del margen.

Falta medirlo cuando el catálogo esté cargado de verdad, y esto es lo que hay que
mirar:

- **Peso medio real tras comprimir.** Si se queda muy por debajo de 400 KB, el
  tope estorba menos de lo que parece y no hay nada que hacer. Si roza el techo,
  o bien las fotos entran ya grandes, o bien 1600 px se queda corto para el tipo
  de imagen que sube el operador.
- **Cuántas sube por unidad.** Los 40 son un margen ancho, no una medida. Si el
  operador se queda en ocho, sobra techo; si fotografía por ambientes —principal,
  baños, sala, cocina, entrada, como hacen Airbnb y Booking— puede acercarse.
- **Egreso mensual de Supabase.** Es el techo que aprieta antes que el
  almacenamiento: 5 GB al mes en el plan gratuito. El panel de Supabase lo
  reporta; contrastarlo con las visitas del mes dice cuánto cuesta cada visita en
  ancho de banda.

Con esos tres números, subir o bajar los topes deja de ser una apuesta. Hasta
entonces, mejor anchos que estrechos: un tope que estorba se nota enseguida, uno
que sobra no molesta a nadie.

Relacionado: la ficha pública muestra cinco fotos. Si el operador sube treinta
agrupadas por ambiente, hace falta decidir cómo se navegan —galería con más
fotos, o agruparlas por estancia como Airbnb, que necesitaría una columna nueva
en `unit_media`.
