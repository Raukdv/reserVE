# Cobro y verificación de pagos

Cómo entra el dinero y cómo se comprueba que entró de verdad.

Junto con el calendario, es la pantalla que define el producto: la que el
operador abre todos los días.

---

## El reporte manual es el camino principal

No es un parche a la espera de una pasarela. **Así se cobra en Venezuela**, y
seguirá existiendo aunque algún día haya integración bancaria: siempre habrá
quien pague por Zelle.

El flujo:

```
huésped paga por su cuenta
      │
      ▼
reporta el comprobante ──▶ pago en «verifying»
      │                     la reserva deja de expirar
      ▼
operador contrasta contra su cuenta
      │
      ├─▶ aprueba ──▶ ¿cubre el anticipo? ──▶ reserva «confirmed»
      │
      └─▶ rechaza ──▶ el huésped puede corregir
```

Lo que el huésped declara: **canal, monto, moneda, referencia, fecha, origen y
captura**. Nada de eso se cree hasta que una persona lo mira.

---

## Los canales

`src/lib/payment-methods.ts` define cada canal con **cómo se llama su dato de
origen y su referencia**, porque no se llaman igual en todos:

| Canal | Moneda | Origen | Referencia |
|---|---|---|---|
| Pago Móvil | VES | Teléfono desde el que pagó | Número de referencia |
| Transferencia | VES | Banco de origen | Número de referencia |
| Zelle | USD | Correo o teléfono del remitente | Número de confirmación |
| Binance Pay | USD | Usuario o correo | ID de orden |
| PayPal | USD | Correo | ID de transacción |
| USDT | USD | Dirección o red | Hash |

Esos seis son los de `GUEST_METHODS`: los que el huésped puede reportar. El
catálogo define tres más que **no** aparecen en su formulario porque no los
reporta él:

- **C2P** — lo confirma el banco por API, cuando haya contrato.
- **Tarjeta** — la confirma la pasarela.
- **Efectivo** — lo registra el operador desde el panel.

El mismo archivo lo usan el formulario del huésped y la bandeja del
administrador, para que los dos hablen del mismo campo con el mismo nombre. Y
lleva un `verifyHint` por canal: **qué hay que mirar** para dar por bueno ese
comprobante —el estado de cuenta, el historial de Binance Pay, el explorador de
la red— que sale escrito en la tarjeta de revisión.

---

## Qué comprueba la base y qué comprueba la persona

`report_payment()` rechaza antes de guardar:

- Reserva inexistente, cancelada, expirada o ya completada.
- Moneda que no sea USD o VES.
- Monto nulo o negativo.
- **Fecha de pago futura** — más de un día por delante es error de captura o
  intento de confundir la verificación.

Lo que **no** puede comprobar es si el dinero llegó. Eso lo hace una persona
mirando su cuenta.

### La referencia no se puede reutilizar

```sql
create unique index payments_unique_approved_reference
  on payments (method, reference)
  where reference is not null and status = 'approved';
```

Es el fraude más común del reporte manual: pegar la referencia de un pago
anterior. El índice es parcial —solo sobre aprobados— para que un huésped pueda
corregir un reporte rechazado sin chocar contra su propio intento fallido.

Al aprobar, el error `23505` se traduce a *«Esa referencia ya respalda otro pago
aprobado»*, no a un fallo genérico.

---

## La conversión a USD se congela con la reserva

Un pago en bolívares se normaliza usando `bookings.rate_snapshot` —la tasa
guardada **cuando se creó la reserva**— y no la tasa de hoy:

```sql
v_amount_usd := case
  when p_currency = 'USD' then round(p_amount, 2)
  else round(p_amount / v_booking.rate_snapshot, 2)
end;
```

Sin eso, una reserva cotizada en enero y pagada en marzo cambiaría de precio sola
entre las dos fechas. El huésped acordó un número; ese número es el que vale.

`rate_used` se guarda en el pago solo cuando la moneda es VES: en un pago en
dólares no hay conversión que auditar.

### Solo la tasa oficial

`current_rate()` ignora el paralelo. La Ley de Precios Justos exige cobrar a la
tasa del BCV, y cobrar a otra es una infracción. El paralelo se registra
únicamente como métrica de brecha, y esa brecha la absorben las tarifas en USD —
no la tasa.

---

## La bandeja de verificación

`/admin/pagos`. Cada pago pendiente es una tarjeta con todo lo necesario para
decidir sin salir de la pantalla:

- **Monto declarado**, y su equivalente en USD si vino en bolívares.
- **El anticipo exigido**, contrastado. Si falta, lo dice: *«faltan X»*, en
  ámbar. Es la comprobación que de verdad decide si la reserva puede confirmarse.
- Origen, referencia, fecha, titular, documento.
- **La captura**, ampliable.
- El `verifyHint` del canal.

### Las capturas van firmadas

El bucket `receipts` es **privado**, a diferencia de `unit-media`. Las URL se
firman por diez minutos al pintar la página. Dejarlo cerrado no es solo
privacidad: una política de inserción anónima permitiría a cualquiera llenar el
gigabyte del plan gratuito.

Las capturas se comprimen en el navegador antes de subir —1280 px, WebP calidad
0,7— y el servidor rechaza por encima de 300 KB. Una captura de pago móvil sin
tratar pesa entre 0,5 y 2 MB; sin comprimir, 1 GB se agota en unos mil
comprobantes. Ver `COSTO-CERO.md`, regla 3.6.

---

## Aprobar confirma la reserva, si alcanza

Al aprobar un pago se suman **todos los aprobados** de esa reserva y se comparan
con el anticipo exigido (`total_usd × deposit_ratio`):

```
paid + 0.01 >= required  ──▶  status = 'confirmed', expires_at = null
```

El margen de un céntimo absorbe el redondeo al convertir pagos en bolívares. Sin
él, un anticipo exacto quedaría corto por 0,004 y **la reserva no se confirmaría
nunca**.

Si no alcanza, el pago queda aprobado igual y el mensaje lo dice: *«Pago
aprobado. Anticipo aún incompleto.»*

### Rechazar no libera las fechas

A propósito. El huésped puede corregir el comprobante mientras la reserva siga
viva; si nunca lo hace, el trabajo de expiración se encarga. Liberar al rechazar
castigaría un error de tecleo con la pérdida de la reserva.

El motivo del rechazo lo ve el huésped.

---

## El operador también cobra a mano

`staff_record_payment()` — para el dinero que entra en efectivo, o por un canal
que el huésped no reportó. Inserta el pago **ya aprobado**, sin pasar por la
bandeja, y la reserva se confirma sola si cubre el anticipo.

`staff_confirm_booking()` — confirmar **sin pago**, cuando se acuerda cobrar
después. Rompe la invariante de «confirmada implica anticipo cubierto», así que
exige un motivo y lo guarda:

```
manual_confirmation_by · manual_confirmation_reason · manual_confirmation_at
```

Para que dentro de tres meses se sepa por qué esa reserva está confirmada sin un
pago detrás.

---

## Salir sin pagar del todo

`staff_check_out()` se **niega** si queda saldo, y hay que marcar «cerrar con
saldo pendiente de todos modos» para forzarlo.

Cerrar una estadía con dinero pendiente es cómo se pierde un cobro: el huésped se
va, la reserva queda «completada» y nadie vuelve a mirarla. A veces se acuerda
cobrar después, pero tiene que ser una decisión consciente y no un descuido.

---

## Pasarelas

`src/lib/payment-providers.ts` es el registro. Hay dos naturalezas y conviene no
mezclarlas: **manual** —una persona verifica— y **pasarela** —el banco confirma
por API y la reserva se confirma sola.

| Proveedor | Estado | Qué falta |
|---|---|---|
| Reporte manual | **Operativo** | — |
| Stripe · tarjetas internacionales | Faltan credenciales | Claves en el entorno. Para cobrar de verdad, entidad legal en país soportado |
| C2P · débito nacional | Falta contrato | RIF, cuenta empresarial, contrato con banco o agregador |
| Botón de pago nacional | Falta contrato | El mismo contrato bancario |

**C2P es el único rail venezolano que permite confirmar una reserva sin
intervención humana**: el huésped genera una clave temporal en su app bancaria y
el débito es inmediato.

Stripe funciona entero en modo de prueba sin verificación de negocio, así que
sirve para desarrollar el flujo. Venezuela no está entre los países donde puede
activarse el modo real.

Todo lo pendiente vive en ese registro y no en el código de reservas, para que
enchufar una pasarela sea añadir una implementación y no tocar el dominio.
`record_gateway_payment()` y `settle_booking()` ya existen (migración `0010`).

---

## Estados

```
payment_status:  pending · verifying · approved · rejected · refunded
payment_kind:    deposit · balance · refund
```

`kind` se decide solo: el primer pago aprobado de una reserva es `deposit`, los
siguientes son `balance`.

---

## Las devoluciones

Cancelar y devolver son **dos hechos distintos**, y se registran por separado.

Cancelar genera una **obligación**: `staff_cancel_booking()` cotiza la política
y congela el resultado en `bookings.refund_due_usd`. Se congela por lo mismo que
la tasa y el desglose de cargos — recalcularlo meses después, con otros tramos o
precios, cambiaría una deuda ya contraída.

Devolver el dinero es un **acto posterior**. Puede tardar días, hacerse en varias
veces, o salir por un canal distinto al del cobro: devolver un Pago Móvil por
Zelle es corriente. Anotarlo en el momento de cancelar sería afirmar que el
dinero se movió cuando sigue en la cuenta.

`staff_record_refund()` anota cada devolución realmente hecha, con su canal,
importe, referencia y nota.

### Por qué `status = 'refunded'` y no `'approved'`

Ocho funciones calculan lo pagado con `sum(amount_usd) where status =
'approved'`. Una devolución guardada como aprobada inflaría ese total, y la
reserva parecería **más** pagada cuanto más dinero se hubiera devuelto.

Guardarlas como `'refunded'` las deja fuera de las ocho sin tocar ninguna, y a la
vez dentro de la lista de movimientos de `get_booking()`, que no filtra por
estado — que es justo donde tienen que verse.

El importe va **positivo**, como cualquier pago: el sentido lo lleva `kind`, no
el signo. En la ficha se pinta con un menos delante, porque en una lista mezclada
con los cobros una devolución sin signo se lee como uno más.

### El tope lo pone la caja, no la política

No se puede devolver más de lo que llegó a entrar, aunque la política dijera otra
cosa. La comprobación es sobre lo cobrado y aprobado menos lo ya devuelto, y el
rechazo dice cuánto queda disponible.

Al revés sí puede pasar: devolver menos de lo que marcaba la política, si se
acordó así. Por eso el formulario admite un importe libre y una nota, y la ficha
muestra lo que falta sin impedir cerrarlo.

---

## IGTF

El Impuesto a las Grandes Transacciones Financieras **lo causa el medio de pago,
no la estadía**. La misma reserva lo genera o no según cómo se cobre:

| Canal | Moneda | IGTF |
|---|---|---|
| Pago Móvil, transferencia nacional, C2P | VES | **0 %** |
| Zelle, PayPal, Binance, USDT, efectivo | USD | **3 %** |

Ese es el motivo por el que el interruptor no hacía nada durante tanto tiempo: el
modelo lo trataba como un impuesto de la reserva, igual que el IVA, y no lo es.

### Lo que exige la norma

- **3 % sobre pagos en divisas o criptoactivos** recibidos sin mediación del
  sistema financiero nacional.
- **0 % en bolívares** desde el Decreto 4.972 (Gaceta 6.821 extraordinario,
  12/07/2024). Antes era 2 %.
- **Solo lo cobra quien esté calificado sujeto pasivo especial** por el SENIAT.
  Quien no lo esté no puede cobrarlo aunque reciba divisas. Por eso el
  interruptor viene apagado.
- **La base incluye los demás impuestos.** Aquí sale solo: se aplica sobre el
  total ya compuesto por `compute_fees()`, que es donde viven los porcentajes.
- En la factura debe reflejarse el porcentaje, el monto en divisas y su
  equivalente en bolívares.

### Proyección al cotizar, importe real al cobrar

Al cotizar no se sabe cómo pagará el huésped, así que ahí solo cabe una
proyección. `quote_stay()` devuelve `igtf_usd` y `total_divisas_usd` **sin tocar
`total_usd`**: la estadía cuesta lo mismo. Sumarlo al total encarecería la
reserva para quien va a pagar en bolívares y nunca lo va a causar.

El checkout lo dice explícitamente, y el formulario de reporte prellena el monto
con el impuesto dentro cuando el canal elegido es en divisas — sin eso, el
huésped transferiría de menos y la reserva no llegaría a confirmarse.

### Se extrae del bruto, no se suma encima

El huésped paga el total **más** el impuesto: es una percepción, la soporta quien
paga y el negocio la entera al fisco. De lo que llega, una parte no es suya.

```
amount       lo que se movió, en su moneda      (bruto)
igtf_usd     la parte que es impuesto           (se entera al SENIAT)
amount_usd   lo que abona a la estadía          (neto)
```

Con alícuota `r`, el bruto es `neto × (1 + r)`, así que el impuesto contenido es
`bruto × r / (1 + r)` — y no `bruto × r`, que cobraría de más.

Guardar el neto en `amount_usd` es lo que mantiene correctas las ocho funciones
que calculan lo pagado con `sum(amount_usd)`: ninguna necesitó cambiar, y
ninguna acredita a la reserva un dinero que no es del negocio.

`bookings.igtf_ves` quedó sin uso: era la columna del modelo equivocado.

---

## Lo que no cubre

**El anticipo se calcula sobre el total con impuestos.** `total_usd ×
deposit_ratio` incluye los cargos de porcentaje. Puede ser lo correcto o no,
pero es una decisión que nunca se tomó explícitamente. Ver `PENDIENTES.md`.

**No hay cobro parcial programado.** El saldo se cobra cuando alguien lo cobra;
nada recuerda que falta salvo la propia reserva.

---

## El anticipo se calcula sobre el total con cargos

```
deposit_usd = total_usd × deposit_ratio
```

Y `total_usd` es el que compone `compute_fees()`: noches más cargos de monto más
cargos de porcentaje. Así que el anticipo arrastra su parte proporcional de la
limpieza y de los impuestos.

Estuvo un tiempo como decisión no tomada — se programó así sin razonarlo. Al
revisarlo, hay dos motivos para dejarlo:

**El legal, que es el que manda.** El artículo 13 de la Ley del IVA fija el hecho
imponible de un servicio en el momento en que *se paga la contraprestación*, nace
la obligación de pagar, se emite la factura o se pone el bien a disposición —
**lo que ocurra primero**. Cobrar un anticipo ya causa el IVA sobre ese anticipo:
no se espera a que el huésped llegue.

Calculado sobre las noches sin impuestos, el negocio debería igualmente el IVA
proporcional de lo recibido y lo estaría adelantando de su bolsillo hasta que
entrara el saldo. Sobre el total con cargos, el anticipo ya trae dentro la parte
que toca declarar ese período.

**El del sector.** En Booking el prepago es un porcentaje del precio total, que
incluye impuestos y cargos. Opera pide el depósito como importe o como porcentaje
del total de la reserva. Airbnb parte el pago normalmente al 50 %, con los
impuestos de alojamiento calculados aparte.

Ejemplo, con IVA del 16 % y anticipo del 30 %:

```
noches            100,00
IVA (16 %)         16,00
                  ───────
total             116,00
anticipo (30 %)    34,80   ← 30 % de 116, no de 100
```

El anticipo arrastra también su parte de la limpieza, que suele no ser
reembolsable. No hay contradicción con la política de cancelación: qué vuelve de
cada cargo lo decide su casilla `refundable`, no el anticipo.

El IGTF va **encima** de esto y no dentro, porque lo causa el medio de pago. Un
anticipo de 34,80 pagado por Zelle son 35,84 transferidos.

---

## Referencias del IGTF

Consultadas en agosto de 2026.

| Fuente | Qué aporta |
|---|---|
| [IGTF y pagos en divisas: efectivo, wallets y criptoactivos — Gálac](https://galac.com/galac-blog/igtf-pagos-divisas-cripto/) | Qué canal lo causa y cuál no: efectivo, Zelle, PayPal y cripto al 3 %; tarjeta de débito nacional que convierte a bolívares, al 0 % |
| [Decreto 4.972 — alícuota 0 % en bolívares](https://gerenciaytributos.blogspot.com/2024/07/decreto-alicuota-cero-IGTF-4972-2024.html) | La bajada del 2 % al 0 % en moneda nacional, en vigor el 15/07/2024. El 3 % en divisas sigue |
| [Se fija en 0 % la alícuota para moneda nacional — Forvis Mazars](https://www.forvismazars.com/ve/es/insights/forvis-mazars-insights/se-fija-en-0-la-alicuota-del-igtf) | Alcance exacto: solo bolívares, dentro y fuera del sistema bancario |
| [Reforma del IGTF: casos prácticos — Gálac](https://galac.com/galac-blog/reforma-del-igtf-algunos-casos-practicos/) | La base incluye el IVA: 100 + 16 de IVA = 116, IGTF = 3 % de 116 |
| [IGTF y pagos en dólares: 10 preguntas — Prodavinci](https://prodavinci.com/igtf-y-pagos-en-dolares-10-preguntas-y-respuestas/) | Quién es sujeto pasivo especial y por qué solo ellos perciben el impuesto |
| [La coletilla del IGTF en facturas — Nayma](https://naymaconsultores.com/la-coletilla-igtf-en-facturas/) | Qué reflejar en la factura: porcentaje, monto en divisas y equivalente en bolívares |

## Referencias del anticipo

| Fuente | Qué aporta |
|---|---|
| [Temporalidad del hecho imponible del IVA en la prestación de servicios](https://gerenciaytributos.blogspot.com/2018/06/temporalidad-del-hecho-imponible-del.html) | Artículo 13: el hecho imponible ocurre al pagar, al nacer la obligación, al facturar o al poner a disposición — lo que ocurra primero. Cobrar un anticipo ya causa el IVA |
| [Ley que establece el Impuesto al Valor Agregado (texto)](http://www.ucv.ve/fileadmin/user_upload/auditoria_interna/Archivos/Material_de_Descarga/Ley_que_Establece_el_Impuesto_al_Valor_Agregado_-_37.999.pdf) | El articulado, para contrastar |
| [Cancellation, deposit and prepayment policies — Booking.com for Partners](https://partner.booking.com/en-us/solutions/cancellation-deposit-and-prepayment-policies) | El prepago es un porcentaje del precio total, impuestos y cargos incluidos |
| [Managing Reservation Deposit Request — Oracle OPERA Cloud](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/ocsuh/t_managing_reservation_deposit_and_cancellation.htm) | El depósito se pide como importe fijo o como porcentaje del total de la reserva |
| [Airbnb ahora permite pagar menos por adelantado — TechCrunch](https://techcrunch.com/2025/08/14/airbnb-will-allow-us-users-to-book-stays-without-paying-up-front) | El pago partido ronda el 50 %, con el resto días antes de la llegada |

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Catálogo de canales | `src/lib/payment-methods.ts` |
| Registro de pasarelas | `src/lib/payment-providers.ts` |
| Formulario del huésped | `src/components/payment-report-form.tsx` |
| Bandeja de verificación | `src/app/admin/pagos/page.tsx` |
| Tarjeta de revisión | `src/components/payment-review-card.tsx` |
| Aprobar y rechazar | `src/app/admin/pagos/actions.ts` |
| Compresión de capturas | `src/lib/compress-image.ts` |
| Reporte del huésped | `report_payment()`, migración `0004` |
| Bucket privado de comprobantes | Migración `0004` |
| Cuentas de cobro | Migración `0006` |
| Pasarelas y liquidación | `record_gateway_payment()`, `settle_booking()`, migración `0010` |
| Cobro y confirmación manual | `staff_record_payment()`, `staff_confirm_booking()`, migración `0011` |
| Devoluciones | `staff_record_refund()` y `refund_due_usd`, migración `0023` |
| IGTF | `igtf_in()` y `payments.igtf_usd`, migración `0024` |
| Referencia única | Índice parcial, migración `0001` |

Decisiones 3, 4, 5 y 6 de `ARCHITECTURE.md`.
