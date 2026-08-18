# Pendientes

Cambios acordados pero no aplicados todavía, con el contexto necesario para
hacerlos sin volver a preguntar. Se borran de aquí al implementarse.

Algunas entradas no son código sino **consultas informativas**: preguntas que
hay que hacerle a alguien que opera de verdad antes de decidir. Van marcadas
como tales, porque implementarlas sin la respuesta es adivinar.

---

## 🗣 Consulta — ¿al huésped que no aparece se le devuelve algo?

**Para preguntar a operadores de alojamiento en Venezuela.** De la respuesta
depende si hace falta escribir código o no.

### Por qué se pregunta

Hoy, cuando alguien no se presenta, la única salida es **cancelar**, que calcula
el reembolso con la política de cancelación: si el tramo vigente dice 50 %, se le
devuelve el 50 %. En hotelería un *no-show* suele tratarse distinto —se retiene
lo cobrado— y por eso los PMS lo tienen como estado propio, separado de la
cancelación. Ver `docs/funciones/night-audit.md`.

No se ha construido ese estado a propósito: no se sabe si aquí se usa.

### Qué preguntar exactamente

1. **¿Al que reserva, paga el anticipo y no aparece, le devuelven algo?**
   ¿Todo, una parte, nada?
2. **¿Depende de si avisó?** Un «no llego» por WhatsApp la víspera, ¿se trata
   como cancelación tardía o como no-show?
3. **¿Cuánto esperan antes de darlo por perdido?** ¿La noche entera, hasta una
   hora concreta, hasta el día siguiente?
4. **¿Revenden la noche si el huésped no llega?** Si la respuesta es que casi
   nunca —reserva anticipada, temporada— el no-show duele menos y quizá no
   merece estado propio.
5. **¿Lo distinguen en sus cuentas?** Si un no-show y una cancelación acaban en
   la misma casilla del cuaderno, tampoco hacen falta dos estados aquí.

### Qué se hace con cada respuesta

- **«Se retiene todo, y lo contamos aparte»** → hace falta el estado `no_show`:
  migración del enum `booking_status`, acción propia que libere las fechas sin
  pasar por `cancellation_quote()`, y su casilla en los informes.
- **«Se aplica la misma política que a una cancelación»** → no hay nada que
  hacer. Lo actual ya lo cubre y el bloque «Requieren revisión» basta.
- **«Depende, se habla con cada uno»** → tampoco hace falta estado nuevo, pero
  quizá sí una nota libre en la reserva para dejar constancia de lo acordado.

### Lo que ya está resuelto

La detección. El panel señala las estadías que vencieron sin cerrarse y el
operador decide. Esta consulta solo afecta a **qué opciones** tiene para
decidir, no a si se entera.

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

## `BUSINESS_TIMEZONE` — conectada a medias

Estaba declarada en `.env.example` y en `serverEnv()` sin que ningún código la
leyera. Ya la lee `businessToday()` en `src/lib/business-date.ts`, que es la
contraparte en Next de `business_today()`: se añadió porque el panel calculaba
«hoy» en UTC y, con Venezuela cuatro horas por detrás, entre las 8 de la noche y
la medianoche enseñaba las llegadas de mañana.

Sigue apareciendo literal como `America/Caracas` en el resto del código —los
formateadores de fecha, `cancellation.ts`, `bcv.ts`— y en las migraciones, donde
no puede leer una variable de entorno.

Queda por decidir si merece la pena terminar de conectarla. Operar en otra zona
exigiría además que `business_today()` y los plazos de cancelación la leyeran de
la base, no del entorno, porque hoy Postgres tiene su propia copia del literal.
Mientras el negocio sea uno solo y esté en Venezuela, el valor coincide y no hay
consecuencia práctica.

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

## Barras a media celda en el calendario del panel

Los PMS comerciales dibujan las estadías desplazadas media columna, de modo que
una salida y una entrada el mismo día se ven como dos triángulos compartiendo el
cuadro. Aquí se pintan como celdas completas adyacentes: correcto respecto al
modelo —el rango `[)` deja libre la noche de salida— pero visualmente sugiere que
ese día está ocupado entero.

Abordarlo junto con arrastrar sobre la rejilla para bloquear fechas.

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
