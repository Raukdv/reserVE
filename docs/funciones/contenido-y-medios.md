# Contenido y medios

Los textos que el operador escribe y las fotos que sube. Dónde viven, qué los
limita y por qué esos límites no son arbitrarios.

---

## El negocio es uno, las unidades son varias

Un negocio con una o varias unidades. Nada más. La unidad puede ser una
habitación, una casa entera o un apartamento.

De ahí sale el reparto:

| Qué | Dónde se llena | Dónde vive |
|---|---|---|
| Nombre, ciudad, dirección, correo, teléfono | Ajustes | `app_settings` |
| Textos de las secciones del sitio | Contenido | `site_content` |
| Fotos del sitio | Contenido | `site_media` + bucket `site-media` |
| Fotos de una unidad | Ficha de la unidad | `unit_media` + bucket `unit-media` |

Hubo una tabla `properties` en medio —negocio, propiedad, unidad— que se eliminó
en la `0030`. Sobraba un nivel: con un solo alojamiento, «propiedad» y «negocio»
eran la misma fila con dos nombres, y cada consulta pagaba un join para no
aprender nada. La latitud y longitud que guardaba se mudaron a
`site_content.location`.

---

## Los textos: una clave, un JSON

`site_content` es `key → data (jsonb)`. Las claves vivas son `hero`, `about`,
`services`, `location`, `contact` y `faq`.

JSON y no columnas porque cada sección tiene una forma distinta —`faq` es una
lista de pares, `location` lleva coordenadas, `hero` es titular y subtítulo— y
columnas para todas significaría una migración por cada texto nuevo. El precio es
que la forma no está garantizada por la base; se valida al leer.

`updated_by` y `updated_at` quedan por saber quién tocó qué. No hay historial:
esto es un sitio de una posada, no un CMS.

---

## Las fotos pesan lo que cuesta servirlas

El límite no es el disco. Es el **egreso**: 5 GB al mes en el plan gratuito de
Supabase, y cada visitante que abre el catálogo se descarga las portadas.

| Peso por foto | Caben en 1 GB | Cargas en 5 GB/mes |
|---|---|---|
| 400 KB (hoy) | ~2.600 | ~13.000 |
| 1 MB | ~1.000 | ~5.000 |
| 5 MB | ~200 | ~1.000 |

A 5 MB por foto, cien visitantes que miren diez imágenes cada uno agotan el mes.
Por eso el peso no sube «porque cabe en disco»: cabe, pero no se puede servir.

Y no hace falta. Comprimidas rondan los 200 KB, así que `MAX_PHOTO_BYTES` en
400 KB deja el doble del margen que se usa.

### Se comprime en el navegador, antes de subir

`compressImage()` redimensiona a 1600 px de lado mayor y convierte a WebP con
calidad 0,75. Una foto de móvil pasa de 2–5 MB a unos 150 KB.

En el navegador y no en el servidor porque **el ancho de banda de subida también
cuenta**, y porque el plan Hobby no está para procesar imágenes.

Ante cualquier fallo —formato raro, canvas bloqueado por privacidad— devuelve el
archivo original y deja que el servidor decida. Es preferible un rechazo claro
por tamaño a perder el archivo en silencio.

### Tres topes, en un solo sitio

```ts
MAX_PHOTO_BYTES            = 400 * 1024   // peso, manda sobre el egreso
MAX_PHOTOS_PER_UNIT        = 40           // cantidad, manda sobre el disco
MAX_SITE_PHOTOS_PER_SECTION = 12
GALLERY_SIZE               = 5            // las que salen en la ficha pública
```

Viven en `src/lib/media-limits.ts` sin dependencias de servidor, porque los
importa también el componente de subida, que corre en el navegador. Estaban
repartidos entre la acción, el componente y la definición del bucket, sin nada
que obligara a moverlos juntos.

El bucket admite 600 KB frente a los 400 KB del servidor. **El hueco es a
propósito**: un archivo que el servidor acepta no debe rechazarlo el
almacenamiento por un redondeo y dejar la subida a medias.

Cuarenta fotos por unidad es alto a propósito. No está para racionar —el gasto lo
marca el peso, no la cantidad— sino para que ninguna lista crezca sin techo. Una
consulta sin tope es una bomba en el presupuesto de CPU del plan Hobby.

---

## El tope se comprueba en la base, no antes

`staff_add_photo()` cuenta y decide dentro de la misma transacción que inserta:

```sql
select id into v_lock from units where id = p_unit_id for update;
select count(*) into v_count from unit_media where unit_id = p_unit_id;
if v_count >= p_max then ... 'too_many'
```

Comprobar antes y luego insertar deja hueco: entre el «¿cuántas hay?» y el
`INSERT` cabe otra subida. Es el mismo razonamiento que el `EXCLUDE` de las
reservas — ver `calendario-y-bloqueos.md`.

**Se bloquea la fila de la unidad, no las fotos.** `for update` no admite
agregados, así que no se puede bloquear un `count(*)`. Bloquear el padre
serializa las subidas de esa unidad, que es justo lo que hace falta.

Para las fotos del sitio no hay fila padre que bloquear —una sección es una
cadena, no un registro— así que `staff_add_site_image()` usa
`pg_advisory_xact_lock(hashtext('site_media:' || p_section))`. Mismo efecto sin
tabla de secciones.

---

## La portada

`unit_media.is_cover`, con índice único parcial: una portada por unidad como
mucho. `staff_set_cover()` apaga la anterior y enciende la nueva en la misma
transacción.

La vista `unit_covers` resuelve cuál sale sin que nadie tenga que elegir:

```sql
select distinct on (unit_id) unit_id, storage_path, alt_text
from unit_media
order by unit_id, is_cover desc, sort_order, created_at
```

Si hay portada marcada, esa. Si no, la primera por orden. Así una unidad con
fotos siempre tiene imagen en el catálogo aunque el operador no haya elegido
ninguna — que es el caso normal el día que sube el lote.

La vista lleva `security_invoker = on`: hereda la RLS de quien consulta en lugar
de saltársela, que es lo que hace una vista por defecto.

---

## Las secciones y el cajón de las sin asignar

```ts
sin_asignar · hero · about · location
```

`sin_asignar` no es una sección de verdad: es donde caen las recién subidas. La
web pública nunca la consulta, así que una foto ahí existe en el panel sin verse
en ningún lado. **Subir un lote y repartirlo después es como se trabaja**, y sin
ese cajón habría que decidir el destino de cada foto en el momento de subirla.

`staff_move_site_image()` cambia la sección y recalcula el orden. Mover a la
misma sección devuelve `unchanged: true` en vez de tocar nada.

### Por qué la lista vive en `src/lib/site-sections.ts`

Estaba junto a las acciones de Contenido, que llevan `'use server'`. Un módulo
así **solo puede exportar funciones async**. Una constante exportada desde ahí no
llega al cliente como su valor: llega como una referencia de acción de servidor,
y cualquier `.find` o `.map` sobre ella revienta en tiempo de ejecución.

El compilador no lo detecta —los tipos son correctos— así que el fallo solo
aparece al abrir la página. Es la clase de error que cuesta una tarde.

---

## Los buckets

| Bucket | Público | Tope | Para qué |
|---|---|---|---|
| `unit-media` | sí | 600 KB | Fotos de las unidades |
| `site-media` | sí | 600 KB | Fotos del sitio |
| `receipts` | **no** | 400 KB | Comprobantes de pago |

Los dos primeros son públicos porque las fotos se sirven al visitante y firmar
cada URL sería trabajo por nada. `receipts` es privado porque un comprobante
lleva datos bancarios de una persona: se sirve con URL firmada y caducidad. Ver
`cobro-y-verificacion.md`.

Los de fotos restringen el tipo MIME a WebP, JPEG y PNG. Un SVG subido a un
bucket público es un vector de scripts. `receipts` admite además PDF, porque
algunos bancos entregan el comprobante así.

---

## El archivo y la fila se limpian en el orden correcto

Subir es dos pasos —objeto al bucket, fila en la tabla— y borrar también. En
ambos casos el orden importa, y en cada uno es el contrario.

**Al subir, primero el archivo.** Si la fila falla —el tope, un error— se borra
el objeto recién subido:

```ts
if (error || !result?.ok) {
  await admin.storage.from(MEDIA_BUCKET).remove([path])
```

Sin eso, chocar contra el tope de cuarenta fotos dejaría un archivo ocupando
cuota que nada referencia. Invisible y para siempre.

**Al borrar, primero la fila.** Si el borrado del objeto falla queda un huérfano,
que es cuota perdida; al revés quedaría una foto rota en el catálogo, que lo ve
el visitante. Se prefiere gastar disco a enseñar un hueco.

---

## Lo que no cubre

**No hay recorte ni reordenación visual.** `sort_order` existe y se respeta, pero
se cambia con botones, no arrastrando.

**No se mide lo que pesan de verdad.** Los cálculos de arriba parten de que
comprimidas rondan los 200 KB. Nadie lo ha medido sobre las fotos reales del
negocio. Ver `PENDIENTES.md`.

**No hay `alt_text` obligatorio.** La columna existe en las dos tablas y casi
siempre está vacía. Es un problema de accesibilidad, no de coste.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Textos del sitio | `site_content`, `/admin/contenido` |
| Fotos del sitio | `site_media`, `staff_add_site_image()`, `staff_move_site_image()`, migraciones `0027` y `0028` |
| Fotos de unidad | `unit_media`, `staff_add_photo()`, `staff_set_cover()`, migraciones `0013` y `0025` |
| Portada resuelta | Vista `unit_covers`, migración `0022` |
| Topes | `src/lib/media-limits.ts` |
| Compresión en el navegador | `src/lib/compress-image.ts` |
| Secciones | `src/lib/site-sections.ts` |
| Subida de unidad | `src/components/unit-photos.tsx` |
| Subida del sitio | `src/components/site-images.tsx` |
| Datos del negocio | `app_settings`, migración `0030` |

Regla 3.6 de `COSTO-CERO.md`.
