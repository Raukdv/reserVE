# reserVE — Arquitectura

Sistema de reservas por fechas para un negocio de alojamiento único (hotel, posada,
casa o complejo habitacional) operando en Venezuela.

No es un marketplace. Hay un solo dueño del inventario, y el sistema está optimizado
para que esa persona gestione su calendario, no para intermediar entre terceros.

> **Restricción de costo cero.** Durante el desarrollo el sistema debe operar sin
> generar cobro en Vercel, Supabase ni Resend. Esta restricción tiene el mismo peso que
> cualquier requisito funcional y condiciona decisiones técnicas concretas: qué rutas
> pasan por el middleware, qué se cachea, dónde corre el trabajo programado.
>
> Se construye contra los límites del plan Hobby de Vercel y el plan gratuito de
> Supabase, que son los más estrictos. Pasar a un plan de pago en producción será
> entonces puro margen, sin rediseño. Ver [COSTO-CERO.md](./COSTO-CERO.md) para los
> límites concretos y las reglas que se derivan de ellos.

## Stack

| Capa | Elección |
|---|---|
| Core | Next.js (App Router) sobre Node.js |
| Auth | Supabase Auth (`@supabase/ssr`, cookies) |
| Datos | Supabase Postgres + RLS |
| Archivos | Supabase Storage (fotos de unidades, comprobantes de pago) |
| Fechas | `date-fns` + `date-fns-tz`, zona horaria del negocio fija |
| Validación | `zod` en todo borde de entrada |
| Email | Resend |

Un solo proyecto y un solo deploy: landing pública, panel de administración y rutas
de API viven juntos.

## Decisiones de fondo

### 1. La base de datos es la que garantiza que no haya doble reserva

Toda la ocupación —reservas y bloqueos manuales por igual— vive en una sola tabla,
`unit_holds`, con una restricción `EXCLUDE USING gist`. Postgres rechaza cualquier
solape a nivel de motor.

Esto no es una optimización: es la diferencia entre un sistema de reservas y un
formulario de contacto. Una validación en JavaScript falla ante dos pestañas abiertas,
dos usuarios simultáneos o un bug de refactor. La restricción no falla nunca.

Como consecuencia, consultar disponibilidad es una sola query contra una sola tabla,
sin importar si la fecha está ocupada por una reserva real o por un bloqueo de
mantenimiento.

### 2. Los rangos de fecha son semiabiertos: `[check_in, check_out)`

El día de salida no cuenta como noche ocupada. Una salida el día 14 y una entrada el
día 14 no se solapan, que es como funciona la hotelería real. `daterange` de Postgres
lo modela nativamente y el operador `&&` lo resuelve sin código propio.

### 3. El dinero es bimoneda con la tasa congelada

Los precios se publican en USD como referencia y se cobran en VES por los canales
oficiales venezolanos, a tasa BCV.

La tasa cambia a diario, así que cada reserva **congela** la tasa que se le aplicó en
el momento de cotizar. Una reserva de hace tres meses jamás se recalcula con la tasa
de hoy. Sin este snapshot, los reportes de ingresos y los saldos pendientes se vuelven
ficción.

**Fecha valor, no fecha de descarga.** `exchange_rates.rate_date` guarda la fecha valor
que el propio BCV declara en su página, no el día en que el alimentador la descargó. La
publicada al cierre del viernes lleva fecha valor del lunes.

**Rige la última publicada.** `current_rate()` devuelve la de mayor fecha valor, sin
mirar el calendario. El BCV abre sobre las 7:00 y cierra entre las 18:00 y las 20:00
VET, y lo que publica es la tasa legal **desde ese instante** —sea de mañana, tarde o
noche—, no desde su fecha valor. El sábado y el domingo se cotizan con el último cierre
del viernes, hasta que el BCV vuelve a abrir el lunes.

Hubo un filtro `rate_date <= business_today()` partiendo de que la fecha valor marcaba
el inicio de la vigencia. Costaba dinero: el fin de semana del 2026-08-21 cotizaba a
779,9522 cuando lo legal eran 784,6633, un 0,6 % de menos en cada reserva.

**Consultar más seguido sí aporta.** Con esta regla, entre que el BCV publica y que
nosotros leemos estamos cobrando con una tasa que ya no es la legal. La frecuencia de
lectura deja de ser comodidad y pasa a ser cumplimiento — ver `docs/funciones/tasa-bcv-y-bimoneda.md`.

**El monto en bolívares caduca; la reserva no.** `bookings.rate_date` guarda la fecha
valor de `rate_snapshot`. Cuando deja de coincidir con `current_rate_date()`, la cifra
en bolívares se recalcula: la reserva sigue viva, lo que vence es el monto. Esto no es
solo protección de margen —la tasa oficial se mueve ~0,45% al día, con saltos de hasta
1,66%—, es lo que la ley exige, porque la factura debe llevar el equivalente a la tasa
**de la fecha de la transacción**.

**Guardia de tasa rancia.** Si la tasa vigente tiene más de 3 días de fecha valor
—tolerancia para fin de semana largo—, `rate_is_stale()` es cierto y `quote_stay()`
devuelve `stale_rate` en vez de cotizar. Un alimentador caído se convierte en un error
visible, no en cobros silenciosamente incorrectos.

**Tasa paralela: métrica, nunca cobro.** `exchange_rates` distingue `market`
(`oficial` / `paralelo`) de `source` (proveedor del dato). El paralelo se registra solo
para medir la brecha —hoy ~11%, en junio ~21%, a principios de 2026 cerca del 40%— y
mostrarla en el panel.

`current_rate()` filtra `market = 'oficial'` y jamás mira la otra. La Ley de Precios
Justos (art. 46 núm. 5) obliga a operar a la tasa del BCV, y además prohíbe ofrecer
precio más bajo por pagar en divisa, así que tampoco cabe disfrazar la brecha como
descuento. **La única palanca legal frente a la brecha es el precio de lista en USD**,
y para eso sirve tenerla a la vista.

Toda lectura de tasas en las páginas pasa por `getRateSummary()`, para que ninguna
consulta suelta olvide el filtro de mercado y acabe cobrando al paralelo.

### 3.1 La zona horaria del negocio es explícita

Postgres corre en UTC y el negocio opera en UTC−4. Entre las 8 de la noche y la
medianoche hora local, `current_date` en la base ya es el día siguiente.

Toda regla de calendario usa `business_today()` en lugar de `current_date`: la
antelación mínima de una reserva, la vigencia de la tasa, y cualquier cosa que
signifique "hoy" para el operador o el huésped.

### 4. El reporte de pago manual es un método de primera clase

En Venezuela la mayoría de los pagos se confirman fuera de banda: el cliente paga por
Zelle, Binance, PayPal o Pago Móvil y reporta el comprobante por WhatsApp o email, y
el negocio verifica a mano.

El sistema absorbe ese flujo dentro de la app en vez de dejarlo en mensajería. El
huésped declara canal, origen, referencia, monto, fecha y sube la captura; el
administrador aprueba o rechaza desde una bandeja dedicada.

Este camino no desaparece cuando se integre C2P. Siempre habrá quien pague por Zelle.

### 5. Los pagos automáticos se integran detrás de una interfaz

El registro vive en `src/lib/payment-providers.ts` y se muestra en `/admin/ajustes` con
el estado de cada uno y qué le falta. Hoy solo `manual` está operativo; el resto declara
sus requisitos en lugar de existir a medias en el código.

**Stripe** es el siguiente candidato porque su modo de prueba funciona sin verificación
de negocio ni país: la integración se escribe y se valida entera antes de tener entidad
legal. Lo que Venezuela impide es **activar cobros reales**, no desarrollar contra la
API. Queda supeditado a una entidad en un país soportado o a un intermediario que
facture.

**C2P y las tarjetas nacionales** dependen de persona jurídica con RIF y contrato
bancario. Sin eso no hay credenciales que pedir, así que no se escribe código
especulativo: solo queda declarado qué haría falta.

### 6. El precio siempre se calcula en el servidor

`quote_stay()` es una función de Postgres. El cliente nunca envía un total; envía
fechas y huéspedes, y recibe el desglose. Cualquier total que llegue desde el navegador
se ignora.

### 7. Las reservas pendientes expiran

Un `pending` retiene inventario. Sin expiración, un carrito abandonado bloquea fechas
vendibles para siempre.

- Pago automático (futuro C2P): TTL corto, 30–60 min.
- Reporte manual: TTL de 24–48 h, porque el huésped necesita ir al banco y volver.

Un job periódico libera lo vencido desactivando el hold.

### 8. La política de cancelación se publica generada, no redactada

Es el único texto legal del sitio que además mueve dinero, y por eso no se
escribe a mano en ninguna parte. `/legal/cancelacion` compone su cuerpo con
`genericPolicy()` a partir de `app_settings.cancellation_tiers`, los mismos
tramos que lee `cancellation_quote()` para decidir cuánto se devuelve. Regla y
texto no pueden separarse porque son el mismo dato leído dos veces.

Estuvo partido en dos: los tramos en Ajustes y un cuerpo libre en Contenido,
apilados uno debajo del otro sin que nada comprobara que dijeran lo mismo. Nada
impedía prometer allí un reembolso que el servidor no fuera a pagar. La
migración `0021` absorbió ese texto en `app_settings` y borró la sección de
Contenido.

Lo que sigue siendo libre —el título y un texto de apoyo— vive junto a los
tramos, y el editor muestra al lado la vista previa de lo que la web ya dice
sola. Escribir la nota sin ver la promesa era la mitad del problema.

**La política es una, y se elige por nombre.** Los tramos viven en la fila única
de `app_settings`, así que nunca hubo forma de tener dos políticas a la vez; pero
el editor las presentaba como fichas sueltas que se añaden y se quitan, y eso se
leía como si se estuvieran apilando. Ahora se elige entre políticas con nombre
—Flexible, Moderada, Limitada, Firme— y la escalera aparece debajo como
consecuencia. El editor tramo a tramo sigue detrás de «Personalizada».

Los nombres y los plazos se calcan de Airbnb, que rehízo su sistema el 1 de
octubre de 2025. Se comprobó antes de tocar nada, porque la duda razonable era
la contraria —que una escalera de varios escalones fuese rara— y resultó ser al
revés: el anfitrión elige **una** política, pero las dos que más lo protegen son
escaleras de tres escalones (100 % / 50 % / nada). Reducir el modelo a un único
plazo habría dejado «Limitada» y «Firme» fuera de su alcance.

`matchPreset()` resuelve qué política está puesta comparando la escalera por
contenido, no guardando su nombre. Así una escalera creada antes de que
existieran los presets se reconoce sola, y editar una hasta convertirla en otra
la reetiqueta sin trucos.

Los cargos son la parte fina. Por debajo del 100 % no lo decide el tramo sino la
casilla `refundable` de cada cargo: los de monto marcados vuelven en la misma
proporción que las noches conservadas, los de porcentaje siguen a su base, y los
no reembolsables no vuelven nunca. El texto público dice exactamente eso y no
nombra la limpieza, que es un cargo más desde que dejó de ser una columna
(`0019`) y puede estar marcada de cualquiera de las dos formas.

### 9. Las estadías a medias se señalan, no se cierran solas

`expire_stale_bookings()` solo toca reservas `pending`. Una `confirmed` cuya
fecha de salida ya pasó —el huésped no apareció, o llegó y nadie lo registró— se
quedaba abierta para siempre, contando como activa en listados y ocupación.

La tentación es que un cron las pase a `completed`. **No se hace**, y la razón es
la misma por la que la salida se niega con saldo pendiente: cerrar una reserva
cierra también una cobranza, y una que se cierra sola es una que nadie vuelve a
mirar. Peor todavía en el otro caso, el del huésped que no apareció: marcarlo
como incidencia decide si se retiene lo cobrado o se devuelve según la política,
y eso no lo puede saber la aplicación.

Es como lo resuelven los PMS. En el cierre de día un no-show no se cierra: se
señala, y el auditor elige entre registrar la entrada, cancelar, o cobrar la
penalización y cancelar. Tres caminos, todos humanos. La aplicación sabe **qué
no se registró**, no **por qué**.

Así que la señal se **deriva en la consulta** y no se escribe en ninguna parte:

```sql
status in ('confirmed', 'checked_in') and check_out < business_today()
```

Sale en «Requieren revisión», arriba del panel, y desaparece sola en cuanto el
operador registra lo que faltaba. Sin fila que corregir, sin estado mal grabado
que arrastrar, y sin un cron que pueda equivocarse en silencio.

El corte es `check_out` y no `check_in` a propósito: hasta la fecha de salida el
huésped todavía puede aparecer, y avisar el mismo día de llegada sería ruido
diario.

### 9.1 El día del negocio también se calcula en Next

`business_today()` resolvía esto en la base, pero el panel componía sus consultas
con `new Date().toISOString()`, que es UTC. Venezuela va cuatro horas por detrás,
así que entre las 8 de la noche y la medianoche «hoy» ya era mañana: las
«llegadas de hoy» mostraban las del día siguiente durante las cuatro horas de más
uso, y la señal de arriba se habría disparado con un día de antelación.

`businessToday()` en `src/lib/business-date.ts` es la contraparte en Next, y lee
`BUSINESS_TIMEZONE` — que estaba declarada y sin usar.

## Modelo de datos

```
auth.users
   └── profiles              rol: admin | staff | guest

properties                   el negocio
   └── units                 habitación / apartamento / casa entera
        ├── unit_media       fotos ordenadas
        ├── unit_amenities   → amenities
        ├── season_rates     daterange → precio/noche + min_nights
        └── unit_holds       ⭐ ocupación con EXCLUDE anti-solape
             ├── bookings         kind='booking'
             └── availability_blocks   kind='block'

bookings
   └── payments              ledger + bandeja de verificación manual

exchange_rates               tasa BCV por día
site_content                 secciones editables del home
app_settings                 configuración del negocio (singleton)
```

## Estados

**Reserva:** `pending → confirmed → checked_in → completed`
con salidas laterales a `cancelled` y `expired`.

Retienen inventario: `pending`, `confirmed`, `checked_in`.

**Pago:** `pending → verifying → approved`
con salidas a `rejected` y `refunded`.

Solo `approved` cuenta para el saldo. La bandeja del administrador es el conjunto
`verifying`.

## Flujo de reserva

```
1. Huésped elige fechas y huéspedes
2. quote_stay() en servidor → desglose USD + VES a tasa BCV de hoy
3. Se crea booking 'pending' + hold activo  → las fechas quedan bloqueadas
4. Paga el anticipo (% configurable) por el método que elija:

   ├─ Canal oficial VE (Pago Móvil, transferencia, C2P manual)
   │     → reporta referencia + captura → payment 'verifying'
   ├─ Divisa (Zelle, Binance, PayPal, USDT, efectivo)
   │     → reporta origen + ID + monto + fecha + captura → payment 'verifying'
   └─ [F2] C2P por API → aprobación síncrona → 'approved' automático

5. Admin verifica en la bandeja → aprueba → booking 'confirmed'
   (o rechaza → el huésped corrige, o el TTL libera las fechas)

6. El saldo restante se cobra antes o durante el check-in
```

## Rutas

**Público**

| Ruta | Contenido |
|---|---|
| `/` | Hero, unidades destacadas, sobre el negocio, galería, servicios, ubicación, FAQ, contacto. Buscador de fechas sticky |
| `/alojamientos` | Listado filtrado por disponibilidad en el rango buscado |
| `/alojamientos/[slug]` | Galería, amenities, calendario, precio en vivo |
| `/reservar/[unitId]` | Datos del huésped → método de pago → reporte de comprobante |
| `/reserva/[code]` | Consulta y gestión por link, sin cuenta obligatoria |
| `/legal/*` | Condiciones y privacidad, editables. Cancelación se genera desde los tramos |

**Administración** (`/admin`, protegido por rol)

| Ruta | Contenido |
|---|---|
| `/admin` | Llegadas y salidas de hoy, ocupación, ingresos del mes |
| `/admin/calendario` | Timeline unidades × días. Arrastrar para bloquear, click para reservar |
| `/admin/reservas` | Lista, filtros, detalle, cambio de estado |
| `/admin/pagos` | ⭐ Bandeja de verificación: comprobante, monto declarado vs esperado, aprobar/rechazar |
| `/admin/unidades` | CRUD, fotos, amenities, reglas |
| `/admin/tarifas` | Temporadas, mínimo de noches |
| `/admin/contenido` | Editar las secciones del home y los legales libres |
| `/admin/ajustes` | Datos del negocio, cobro, políticas de cancelación, IGTF |

Las dos pantallas que definen el producto son el **calendario timeline** y la
**bandeja de pagos**. Son las que el operador abre todos los días.

### El calendario timeline

Filas = unidades, columnas = días, barras = ocupación. Es la convención de los
*channel manager* hoteleros —el calendario múltiple de Airbnb, la extranet de
Booking, Cloudbeds, Lodgify— y por debajo es un diagrama de Gantt.

Se eligió frente a un calendario de mes porque la ocupación es bidimensional: qué
unidad × qué noches. Un calendario de mes solo tiene una dimensión, así que con N
unidades harían falta N calendarios y no se podría responder de un vistazo la
pregunta diaria del operador: *¿qué tengo libre el fin de semana que viene?*

En esta forma los huecos son espacio en blanco, así que lo vendible salta a la
vista, y las noches huérfanas —el hueco de una o dos noches entre dos reservas que
nadie compra— se detectan sin contar.

El color codifica **estado**, no unidad: el operador escanea buscando qué requiere
acción. Colorear por unidad no diría nada accionable.

Está acotado a 45 días por vista. No es una decisión estética: cada celda es un
nodo del DOM y renderizar sin tope quema el presupuesto de CPU del plan Hobby.
Ver `COSTO-CERO.md`, regla 3.8.

**Pendiente — barras a media celda.** Los PMS comerciales dibujan las estadías
desplazadas media columna, de modo que una salida y una entrada el mismo día se
ven como dos triángulos compartiendo el cuadro. Aquí se pintan como celdas
completas adyacentes: correcto respecto al modelo, ya que el rango `[)` deja libre
la noche de salida, pero visualmente sugiere que ese día está ocupado entero. Se
abordará junto con arrastrar para bloquear.

## Fases

**F1 — Núcleo** *(completada)*
Esquema, RLS, restricción anti-solape, unidades, disponibilidad, cotización bimoneda,
reserva con reporte de pago manual, calendario de admin, bandeja de pagos.

El circuito cierra: reservar → ver dónde pagar → reportar el comprobante → verificar en
el panel → fecha bloqueada en el calendario.

Cuatro funciones sostienen el flujo, todas `SECURITY DEFINER` porque quien reserva no
tiene sesión:

- `create_booking()` — hold y reserva en la misma transacción. La carrera entre dos
  huéspedes por el mismo rango la resuelve el `EXCLUDE`, capturando `exclusion_violation`:
  entre un "¿está libre?" y el `INSERT` siempre cabe otra transacción.
- `get_booking(code)` — el huésped gestiona por enlace, sin cuenta.
- `report_payment()` — deriva el monto en USD en el servidor; nunca lo acepta del cliente.
- `refresh_booking_rate()` — recalcula solo la cifra en bolívares.

Las tablas de admin siguen pendientes: `/admin/reservas`, `/unidades`, `/tarifas`,
`/contenido` y `/ajustes`.

**F2 — Público y automatización**
Landing con contenido editable, emails transaccionales, gestión de reserva por link,
integración C2P real cuando exista RIF jurídico.

**F3 — Internacional y fiscal**
dLocal Go o Binance Pay, IGTF si el negocio es designado contribuyente especial,
facturación.

**F4 — Extras**
Sincronización iCal con Airbnb y Booking, multi-idioma, check-in online, cupones.

F1 deliberadamente no depende de ninguna API bancaria. El flujo manual es el fallback
permanente del sistema, y construirlo primero permite que la app venda antes de que se
aprueben contratos bancarios, que en Venezuela tardan semanas.

## Notas fiscales

El **IGTF** es un impuesto del 3% sobre pagos en divisas y criptoactivos. Solo están
obligados a recaudarlo los negocios designados **contribuyentes especiales** por el
SENIAT. Se desglosa en factura junto al IVA del 16% y se paga en bolívares a tasa BCV.

Queda como bandera de configuración, apagada por defecto, con el campo ya presente en
el esquema para no requerir migración si el negocio cambia de condición.

## Trampas evitadas por diseño

- Fechas en UTC contra zona local — la zona del negocio es fija y explícita.
- Precio calculado en el cliente — `quote_stay()` es autoridad única.
- `pending` sin expiración — job de liberación.
- Referencia bancaria reutilizada — índice único sobre referencias aprobadas.
- Tasa BCV recalculada — snapshot por reserva.
- Solape entre reserva y bloqueo manual — ambos viven en la misma tabla.
