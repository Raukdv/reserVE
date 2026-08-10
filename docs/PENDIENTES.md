# Pendientes

Cambios acordados pero no aplicados todavía, con el contexto necesario para
hacerlos sin volver a preguntar. Se borran de aquí al implementarse.

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
