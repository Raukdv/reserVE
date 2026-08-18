# Sistema visual

Estado **actual**, medido sobre el código, no una propuesta. Sirve para revisar
la app con una referencia delante y para anotar decisiones según se tomen.

Al final hay una sección con lo que ya se ve roto en este inventario.

---

## Color

### Paleta declarada

En `src/app/globals.css`, bloque `@theme`. Tailwind genera de ahí `bg-ink`,
`text-sand`, etc., y admite opacidad con `/`.

| Token | Valor | Para qué | Usos |
|---|---|---|---|
| `ink` | `#16130f` | Texto, bordes, superficies oscuras | 576 |
| `sand` | `#f6f1e9` | Fondo de página | 32 |
| `moss` | `#4a5d4e` | Confirmado, aprobado, éxito | 43 |
| `tide` | `#3d6b78` | Hospedado, en curso | 14 |
| `clay` | `#b4794f` | Acento cálido, hoy en el calendario | 14 |

Es una paleta cálida y apagada: arena y tinta casi negra, con verde musgo y azul
petróleo como únicos colores saturados.

### Códigos de estado

El color codifica **estado**, nunca identidad. Dos unidades distintas no llevan
colores distintos; una reserva pendiente y una confirmada, sí.

| Estado | Tono | Criterio |
|---|---|---|
| Pendiente de pago | ámbar | **El único que reclama atención**: exige hacer algo |
| Confirmada | `moss` | Informativo |
| Hospedado | `tide` | Informativo |
| Bloqueo manual | `ink/15` | Inerte |
| Error / rechazo | rojo | Excepcional |

`confirmed` y `checked_in` se separan por **tono**, no por intensidad. Dos
variantes del mismo verde eran indistinguibles en una barra de 28 px, y oscurecer
una la ponía a competir con el ámbar.

### Escala de tinta

La opacidad sobre `ink` hace de escala de grises. **Para texto solo hay tres
peldaños**, y los tres pasan el mínimo de contraste AA (4.5:1) sobre los dos
fondos de la app:

| Clase | Sobre blanco | Sobre `sand` | Para qué |
|---|---|---|---|
| `text-ink` | 18.5:1 | 16.5:1 | Titulares, datos principales, cifras |
| `text-ink/80` | 8.9:1 | 8.4:1 | Énfasis dentro de texto apagado |
| `text-ink/70` | 6.9:1 | 6.5:1 | Descripciones, cuerpo, etiquetas de campo |
| `text-ink/60` | 4.9:1 | 4.6:1 | **Suelo.** Metadatos, marcas de tiempo, ayudas |

Por debajo de `/60` no hay nada de texto. La medición de por qué:

```
opacidad   sobre blanco   sobre arena   AA normal (4.5)
  ink/40      2.58           2.55         FALLA
  ink/45      2.99           2.93         FALLA
  ink/50      3.48           3.40         FALLA
  ink/55      4.10           3.96         FALLA
  ink/60      4.86           4.64         pasa
```

El sistema anterior tenía nueve peldaños de `/20` a `/80` y **279 usos de texto
caían por debajo del umbral**. El error de fondo no era el contraste sino lo que
lo causaba: se estaba usando la opacidad para crear jerarquía, y por debajo de
cierto punto la opacidad no jerarquiza, borra. La jerarquía la dan ahora el
tamaño, el peso y el espacio.

Bordes y fondos no son texto y conservan sus opacidades bajas:

```
border-ink/10   separadores y bordes de tarjeta
border-ink/15   bordes de campo de formulario
border-ink/20   bordes discontinuos de estado vacío
border-ink/40   borde al enfocar

bg-ink          botón principal
bg-ink/8        píldoras y fondos sutiles
bg-ink/6        píldoras de método de pago
bg-ink/5        superficies muy tenues
```

---

## Tipografía

Una sola familia: la pila del sistema (`ui-sans-serif, system-ui, -apple-system,
'Segoe UI', sans-serif`). **No hay fuente de display ni serif.**

### Escala

De arriba abajo, y cada peldaño con su papel:

| Papel | Clases | Tamaño |
|---|---|---|
| Hero público | `text-4xl sm:text-6xl font-semibold leading-[1.1] tracking-tight` | 36 → 60 px |
| Título de página pública | `text-3xl font-semibold tracking-tight` | 30 px |
| Título de página del panel | `text-2xl font-semibold tracking-tight` | 24 px |
| Título de sección pública | `text-3xl font-semibold tracking-tight` | 30 px |
| **Título de sección del panel** | `text-base font-semibold` | 16 px |
| **Entradilla pública** | `text-entrada` | 18 px / 1.7 |
| **Descripción de sección** | `text-descripcion text-ink/70` | 15 px / 1.6 |
| Cuerpo y campos | `text-sm` | 14 px |
| Metadatos y ayudas | `text-xs text-ink/60` | 12 px |
| Antetítulo | `text-xs font-semibold uppercase tracking-wider text-ink/60` | 12 px |
| Píldoras densas | `text-[11px]` | 11 px |

Títulos siempre `font-semibold`; `tracking-tight` solo a partir de `text-xl`,
donde el apretado se nota. Cuerpo en peso normal.

### Por qué `text-descripcion` es un paso propio

Es el token de `globals.css` para la línea que explica un encabezado —
*«Aparecen en la web pública, en los correos y en el pie de página»*. Antes era
`text-sm text-ink/50`: pequeña **y** apagada a la vez. Dos señales de
subordinación sobre el mismo texto lo empujan fuera de la lectura en lugar de
ordenarlo debajo del título.

Ahora sube a 15px con interlineado 1.6 y sube a `text-ink/70`. La subordinación
la marca el encabezado, que es un punto mayor y semibold; la descripción no
necesita disculparse por existir.

El par canónico, tal como está en Ajustes:

```tsx
<h2 className="text-base font-semibold">Pasarelas de pago</h2>
<p className="mt-1 text-descripcion text-ink/70">
  Cobros que se confirman solos, sin verificación manual.
</p>
```

### Antetítulo, no cuarto nivel

`text-xs font-semibold uppercase tracking-wider text-ink/60` etiqueta un bloque
dentro de una sección («Falta», «Últimos envíos», las categorías de amenidades).
Es más pequeño que el cuerpo a propósito: no compite por la lectura, orienta. El
peso semibold y el espaciado entre letras lo separan del metadato, que comparte
tamaño y color pero va en peso normal.

---

## Espaciado y contenedores

### Anchos de página

| Ancho | Dónde |
|---|---|
| `max-w-6xl` | Páginas públicas |
| `max-w-7xl` | Calendario y listado de reservas, que necesitan aire horizontal |
| `max-w-3xl` | Formularios y páginas de una columna |
| `max-w-2xl` | Textos legales, medida de lectura |

Con `px-6` siempre, y `py-8` en el panel, `py-10`–`py-20` en público.

### Tarjetas

El patrón que se repite en toda la app:

```
rounded-2xl border border-ink/10 bg-white p-6
```

Variantes: `p-5` cuando la tarjeta es una fila de lista, `p-12` en estados
vacíos, y `border-dashed border-ink/20` para lo que aún no existe.

### Radios

| Radio | Para qué |
|---|---|
| `rounded-2xl` | Tarjetas y paneles |
| `rounded-xl` | Campos de formulario y botones grandes |
| `rounded-lg` | Botones y campos compactos, sobre todo en el panel |
| `rounded-full` | Píldoras de estado |

---

## Componentes

### Botones

```
principal    rounded-xl bg-ink px-6 py-2.5 text-sm text-sand
             transition hover:bg-ink/85 disabled:opacity-50

secundario   rounded-lg border border-ink/15 px-4 py-2 text-sm
             transition hover:border-ink/40

terciario    text-sm text-ink/70 underline hover:text-ink

destructivo  text-sm text-ink/60 underline hover:text-red-700
```

Todo botón que dispara una acción de servidor cambia su texto mientras trabaja
—«Guardando…», «Aprobando…»— y se deshabilita. No es adorno: sin eso se envía
dos veces.

### Cuándo usar cada nivel

Los cuatro estilos existían sin regla que dijera cuál tocaba, y el terciario
acabó haciendo cuatro trabajos distintos con la misma pinta: navegar a otra
página, borrar algo, enlazar dentro de una frase y ser la acción principal de un
estado vacío. Medido: **65 enlaces de solo texto frente a 46 botones con borde y
29 sólidos** — el elemento interactivo más común era el que menos se distinguía
del texto.

| Papel | Qué usar |
|---|---|
| Enviar un formulario, o la única acción esperada en un estado vacío | **Principal** |
| **Ir a otra pantalla**, estando el enlace suelto | **`LinkButton`** — píldora con icono |
| Acción secundaria dentro de un bloque | **Secundario** |
| Enlace dentro de una frase | **Terciario**, texto subrayado |
| Borrar, quitar, descartar | **Destructivo**, texto subrayado |

Los dos últimos se quedan como texto a propósito. Un botón llamativo para
«Borrar» invita al accidente, y un enlace dentro de un párrafo debe parecer un
enlace, no un control incrustado en la prosa.

### `LinkButton`

`src/components/link-button.tsx`. Píldora con icono para los enlaces que llevan
a otra pantalla y van sueltos: «Ver todos», «Editar catálogo», «Ver la web»,
volver atrás.

No es cuestión de gusto. **WCAG 2.5.8 pide un objetivo de al menos 24×24 px**, y
un enlace de texto a 14 px mide unos 14 de alto: no llega, y en móvil se falla al
pulsarlo. Con `px-4 py-2` el objetivo pasa de 36 px.

El icono tampoco es adorno: es lo que hace que se lea como control antes de leer
la etiqueta. `lucide-react` ya está en el proyecto y hace *tree-shaking*, así que
cada icono nuevo no suma peso apreciable.

### Campos

```
w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm
outline-none focus:border-ink/40
```

Tres niveles, y ninguno comparte formato con otro:

```
etiqueta   text-sm font-medium text-ink      (xs en editores densos)
ayuda      text-xs text-ink/60
error      text-sm text-red-700   + border-red-400 en el campo
```

La etiqueta va en tinta plena y peso medio porque **nombra** el campo: antes iba
en `text-ink/70`, el mismo color que las descripciones de sección, y en un
formulario largo no se distinguía lo que titulaba un input de lo que explicaba el
bloque entero.

En el panel la variante compacta usa `rounded-lg px-3 py-2`.

### Estados vacíos

```
rounded-2xl border border-dashed border-ink/20 p-12
text-center text-sm text-ink/70
```

Siempre dicen qué falta y, cuando existe, enlazan a la acción que lo resuelve.

### Píldoras de estado

```
rounded-full px-2.5 py-1 text-xs
```

Con el color al 15 % de fondo y el tono pleno en el texto: `bg-moss/15 text-moss`.

---

## Principios en uso

**El color codifica estado, no identidad.** Ver arriba.

**Solo una cosa reclama atención por pantalla.** En el calendario es el ámbar de
«pendiente de pago». Si todo destaca, nada destaca.

**Los estados vacíos explican y ofrecen salida.** Nunca un espacio en blanco.

**El texto dice qué pasa, no qué botón pulsar.** «Quedan 44,00 USD sin cobrar.
Regístralos arriba» en vez de «Operación inválida».

**Nada de imágenes remotas de terceros.** Las fotos van a Supabase Storage. Sin
optimización de imágenes de Vercel: se suben ya redimensionadas y se sirven
estáticas (`COSTO-CERO.md`, regla 3.5).

**Marcadores honestos.** Mientras no hay foto, `UnitThumb` pinta un degradado
derivado del slug —estable entre recargas y entre pantallas— en vez de una imagen
de archivo que finge ser el alojamiento.

---

## Observaciones de revisión

Detalles encontrados usando la app. Sin implementar todavía; se van tachando al
resolverse.

### ~~1. La portada de una unidad se elige sola~~ — resuelto

**Dónde:** `/admin/unidades/[id]`, bloque de fotos.

> **Resuelto en la migración `0025`.** `unit_media.is_cover` marca la elegida,
> con un índice único parcial que impide dos por unidad. La vista `unit_covers`
> ordena por la marca primero y por `sort_order` después, así que **borrar la
> marcada devuelve la portada a la primera** en lugar de dejar la unidad sin
> cara — de las dos salidas que se planteaban abajo, esta es la que no deja
> estado roto.
>
> El orden sigue mandando en la galería; son dos decisiones separadas.

Lo que sigue es el planteamiento original.

La primera foto de la lista es la portada, y eso no lo decide el operador: lo
decide el orden de subida. Para cambiarla hay que mover la imagen con las flechas
hasta el principio, que es una forma indirecta de expresar «quiero esta».

Debería poder marcarse cualquier foto como portada directamente. El orden del
resto seguiría sirviendo para la galería, pero dejarían de ser la misma decisión.

Al implementarlo:

- La portada es una propiedad de la unidad, no una posición en una lista. O una
  columna en `unit_media`, o una referencia en `units`.
- Hace falta decidir qué pasa al borrar la foto marcada: la siguiente pasa a
  serlo, o la unidad se queda sin portada hasta que se elija otra.

### ~~2. Subir fotos son tres pasos y solo admite una~~ — resuelto

**Dónde:** el mismo bloque.

> **Resuelto.** Arrastrar y soltar, selección múltiple, y subida automática al
> elegir: se quitó el botón de confirmar porque elegir ya es confirmar.
>
> La cola es **secuencial**, no paralela: cada acción de servidor lleva un
> archivo —el límite de cuerpo por defecto de Next es 1 MB y varias fotos no
> caben— y comprimir varias a la vez congela el navegador. Cada archivo lleva su
> propio estado, así que uno que falle no cancela los demás.
>
> Lo del `sort_order` se resolvió en la base: `staff_add_photo()` bloquea la fila
> de la unidad y calcula el orden y el tope en una sola sentencia. Contarlas
> desde el servidor y después insertar dejaba una carrera que con selección
> múltiple habría dejado de ser teórica.

Lo que sigue es el planteamiento original.

Hoy: pulsar el campo, elegir el archivo en el diálogo del sistema, y **volver a
pulsar** «Añadir foto». Ese último paso no aporta nada — ya se eligió el archivo,
la confirmación sobra.

Y solo entra una imagen por vez. Cargar la galería de un alojamiento son ocho o
diez repeticiones del mismo ciclo.

Debería ser:

- **Arrastrar y soltar** sobre la zona, además del diálogo de siempre.
- **Selección múltiple**, y que suba en cuanto se elijan, sin confirmación.

Al implementarlo:

- La acción de servidor recibe un archivo; habría que aceptar varios, o
  invocarla una vez por archivo desde el cliente.
- La compresión ya ocurre en el navegador y tarda: con varias imágenes hace falta
  progreso por archivo, no un único «Optimizando…».
- Un archivo que falle —demasiado grande, formato raro— no debe cancelar los
  demás. Error por imagen, no por lote.
- El `sort_order` se asigna al insertar; con subidas en paralelo hay que evitar
  que dos acaben con el mismo número.

### ~~3. Amenidades: sin catálogo de partida y sin forma de administrarlo~~ — resuelto

**Dónde:** `/admin/unidades/[id]`, bloque de amenidades.

La tabla `amenities` ya es dinámica —vive en la base y las unidades apuntan a
ella— pero le faltan las dos puntas:

**No hay lista de partida.** Las diez que existen hoy las metió
`scripts/seed.mjs`, que es un script de datos de ejemplo. Una instalación limpia
abre esa sección vacía, sin nada que marcar y sin pista de qué poner.

Deberían venir precargadas por migración, no por sembrado: son vocabulario del
dominio, no datos de prueba.

**No hay forma de añadir ni editar.** Solo se pueden marcar y desmarcar las que
existen. Si el anfitrión ofrece algo que no está en la lista, no puede añadirlo
desde el panel — hace falta tocar la base.

Al implementarlo:

- Dónde vive el CRUD del catálogo. Es transversal a todas las unidades, así que
  no encaja en la ficha de una: o página propia, o dentro de Ajustes.
- Con la lista creciendo, las casillas sueltas dejan de servir. Hace falta
  **buscar y filtrar**, y probablemente agrupar por categoría —conectividad,
  climatización, servicios, exteriores—, cosa que la tabla hoy no contempla.
- Borrar una amenidad en uso la quita de todas las unidades en silencio, porque
  `unit_amenities` cascadea. Debería avisar de cuántas la usan, como ya hace el
  borrado de unidades con reservas.

**Además:** la columna `amenities.icon` guarda valores (`wifi`, `snowflake`,
`coffee`) que **no se renderizan en ninguna parte**. La ficha del alojamiento
pinta un punto de color para todas por igual. O se usan de verdad, o sobra la
columna — hoy es un dato que promete algo que no cumple, como pasaba con
`BUSINESS_TIMEZONE`.

### El catálogo del home es un cuaderno que se hojea

Reservar es *to book*, y el listado del home pasa página a página. Cada hoja es
un alojamiento: portada, nombre, capacidad y precio.

**CSS 3D puro, sin librería.** El contenedor abre `perspective`; la hoja que gira
lleva `transform-origin` en el lomo, así rota sobre el pliegue como el papel.
`backface-visibility: hidden` permite pintar las dos caras en el mismo elemento
—delante la que se va, detrás la que llega— y durante el giro se superpone una
hoja extra que desaparece al terminar. Sin ese elemento intermedio el cambio
sería instantáneo.

El papel crema no hubo que inventarlo: `sand` ya es eso. Cada página va con un
degradado hacia el lomo y el pliegue son dos sombras encontradas.

#### Dónde sí y dónde no

| | Qué se muestra | Por qué |
|---|---|---|
| Home, `sm` en adelante, **3+ unidades** | Cuaderno | Es el escaparate |
| Home, 1 o 2 unidades | Rejilla | Caben en un pliego: el libro deja las flechas apagadas y un contador que dice «1 de 1» |
| Home, móvil | Rejilla | Un pliego son dos páginas; en 360 px cada una queda en 180, ni para la foto |
| `/alojamientos` | Rejilla | Es el listado, y comparar se hace en paralelo, no pasando hojas |

La separación importa: **el cuaderno es escaparate, la rejilla es catálogo.** Por
eso el enlace «Ver todos los alojamientos» está fijo debajo del libro y no en la
hoja de cierre — quien quiere entrar directo no debería tener que hojearlo entero
para encontrar la salida. La hoja de cierre se queda, pero solo con una
despedida.

**Umbral por revisar más adelante:** por encima de seis u ocho unidades el
cuaderno empieza a estorbar —serían cuatro o más pliegos que paginar— y conviene
volver a mirarlo.

Respeta `prefers-reduced-motion`: con esa preferencia el giro se anula y la
página cambia sin animación. La regla vive en `globals.css` y cubre toda la app,
no solo el libro.

### 4. No hay dónde ver lo que el negocio ha generado

**Dónde:** falta la sección. Hoy lo más parecido es el resumen de `/admin`.

El panel enseña cifras sueltas —pagos por verificar, reservas pendientes,
confirmadas, tasa— y ninguna serie. El operador no tiene dónde mirar **cuánto ha
entrado este mes**, ni compararlo con el anterior, ni ver por dónde entró.

Debería haber una sección de **ganancias** con gráficas directas: lo generado en
el mes, de un vistazo.

#### La distinción que hay que resolver antes de dibujar nada

«Ganancias» no es «lo que pasó por la cuenta». Con el modelo actual hay cuatro
cosas distintas y confundirlas produce un gráfico que miente:

| Concepto | Qué es | De dónde sale |
|---|---|---|
| **Cobrado** | Todo lo que entró | `payments` aprobados |
| **IGTF** | **No es ingreso.** Se entera al SENIAT | `payments.igtf_usd` |
| **Devuelto** | Sale de la cuenta | `payments` con `kind = 'refund'` |
| **Ingreso real** | Cobrado − IGTF − devuelto | la resta de los tres |

`amount_usd` ya viene **neto de IGTF** desde la migración `0024`, así que sumarlo
da lo que de verdad es del negocio. Lo que falta restar son las devoluciones, que
desde la `0023` están registradas y hasta entonces no existían.

Ojo también con los cargos: la limpieza y las tasas turísticas **sí** son ingreso;
el IVA **no** — se cobra al huésped y se entera al fisco, igual que el IGTF. La
diferencia es que el IGTF ya vive fuera (`payments.igtf_usd`) y el IVA es un
cargo más, indistinguible de un recargo que sí te quedas.

**Eso bloquea esta sección** y tiene su propia entrada en `PENDIENTES.md`:
«Separar los impuestos de los ingresos». Sin resolverlo, cualquier gráfica infla
la cifra en la proporción exacta del tipo impositivo.

#### Qué forma tiene cada cosa

Anotado tras revisar la referencia de Amicro que motivó esto:

- **Ingreso por mes** → barras. Comparar doce valores es lo que peor hace un
  donut y lo que mejor hace una barra.
- **Ocupación del mes** → donut de dos segmentos, con el porcentaje al centro.
  Es parte de un todo y son dos valores: justo donde el donut gana.
- **Por dónde entró el dinero** → barras horizontales. Con seis canales de pago,
  comparar arcos es adivinar.
- **Reservas por estado** → nada. Ya lo dicen las píldoras de color sin gráfico.

#### Al implementarlo

- **Sin librería de gráficos.** Un donut es un `<circle>` con `stroke-dasharray`,
  `stroke-linecap="round"` para los extremos y un hueco restado a cada arco; unas
  ciento cincuenta líneas de SVG. Las barras, menos. Meter Motion o una librería
  de charts por esto es pagar decenas de KB en el teléfono del huésped para algo
  que solo ve el operador.
- **Falta paleta de series.** Hay cinco tokens y ninguno pensado para distinguir
  categorías vecinas en un gráfico. La referencia lo resuelve con grises sobre
  negro; sobre nuestra arena eso no funciona. Decidir la escala antes de dibujar.
- **Cargar antes la guía de visualización del proyecto**, que fija paleta de
  series y contraste. Es lo que evita inventar una escala que luego choque con
  `DISENO.md`.
- **Ojo con el tope de CPU.** Agregar por mes en el servidor y no traer todas las
  filas para sumarlas en el navegador. Ver `COSTO-CERO.md`.

---

## Lo que este inventario deja a la vista

Medido, no opinado.

### ~~La escala tipográfica está aplastada~~ — resuelto en parte

`text-sm` aparecía 296 veces y `text-xs` 127: el 88 % del texto de la app entre
dos tamaños. Todo pesaba lo mismo y nada guiaba la mirada.

Resuelto en el panel: los encabezados de sección subieron de 14 px normal a
16 px semibold (27 sitios) y las descripciones a 15 px (44 sitios), que es donde
el salto se nota más porque es el par que más se repite.

Resuelto también en la web pública, que tenía el problema contrario: los tamaños
grandes sí existían —hero de 60 px, secciones de 30— pero debajo se caía directo
a los 16 del cuerpo. Entre un titular de 30 y un párrafo de 16 no hay
transición: el ojo salta.

`text-entrada` —18 px con interlineado 1.7— es ese peldaño. Se aplica al párrafo
que abre cada sección: el subtítulo del hero, la entrada de Alojamientos, los
cuerpos de «sobre nosotros» y «cómo llegar», y la descripción de cada
alojamiento. El cuerpo se queda en 16.

La escala pública queda: **60/36 → 30 → 18 → 16 → 15 → 14 → 12**.

En el panel no hace falta ese escalón: allí los titulares son de 16 y la
descripción de 15, un salto corto a propósito porque se lee de trabajo.

### No hay voz tipográfica

Una sola familia, la del sistema. Funciona y no cuesta nada, pero no dice nada:
una posada frente al mar y un panel de facturación se ven igual.

`next/font` autoaloja en el build, así que añadir una familia de display es
compatible con costo cero.

### El ámbar y el rojo no están en la paleta

64 usos de `amber-*` y `red-*` de la paleta por defecto de Tailwind, frente a
cinco tokens propios. Los dos estados más importantes de la app —lo que exige
acción y lo que falló— son los únicos sin token.

Deberían ser `--color-alert` y `--color-danger`, o equivalentes.

### ~~La escala de tinta no tiene peldaños definidos~~ — resuelto

En uso había nueve valores entre `/20` y `/80`, sin regla que dijera cuál tocaba
en cada caso. La diferencia entre `/45` y `/50` no la distingue nadie, pero
obligaba a decidir en cada componente — y 279 de esos usos no llegaban al mínimo
de contraste AA.

Colapsada a tres peldaños de texto: `text-ink`, `text-ink/70`, `text-ink/60`.
Ver [Escala de tinta](#escala-de-tinta). 380 clases sustituidas; no queda ningún
texto por debajo del suelo.

### ~~Faltan fotos~~ — la web ya las pinta

Las fotos **son** el producto en un sitio de alojamiento, y hasta ahora la web
pública no mostraba ninguna: se subían al panel y se quedaban ahí, porque
`UnitThumb` solo sabía pintar su degradado de marcador.

Resuelto: `UnitThumb` acepta una foto y cae al degradado solo cuando no la hay.
El degradado se queda **detrás** de la imagen, así que es lo que se ve mientras
carga y lo que queda si el archivo falla; sin eso el hueco es blanco y la
tarjeta salta al terminar de bajar.

Queda decidir el diseño sabiendo que las fotos mandan, que era la otra mitad de
esta observación. Con imágenes reales puestas ya se puede.
