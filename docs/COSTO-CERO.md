# Costo cero — restricción estructural

**Durante el desarrollo, reserVE no debe generar cobro en ningún servicio:
Vercel, Supabase ni Resend.**

No es una preferencia de arranque. Es una restricción de diseño con el mismo
peso que "no debe permitir dobles reservas", y condiciona decisiones técnicas
concretas: cómo se cachea, dónde corre el trabajo programado, qué rutas pasan
por el middleware.

La estrategia es construir contra los límites **más estrictos** —los del plan
Hobby de Vercel y el plan gratuito de Supabase—. Cuando el negocio salga a
producción real y haya que pasar a planes de pago, subir de plan será puro
margen: nada que rediseñar, solo soltar el freno.

---

## 1. En Hobby el riesgo no es la factura, es el bloqueo

El plan Hobby no tiene ciclo de facturación. No hay tarjeta, no hay cobro por
exceso. Cuando se supera un límite:

> «En la mayoría de los casos, si superas tus límites de uso en el plan Hobby,
> tendrás que esperar 30 días antes de poder usar esa función de nuevo.»

Esto reencuadra el problema por completo. **El costo cero está garantizado por
construcción.** Lo que hay que evitar es que la app quede inutilizable durante un
mes por haber quemado una cuota.

Corolario práctico: no hace falta vigilar el gasto, hace falta vigilar el
consumo. Y los dos consumos que se agotan primero son las **invocaciones de
función** y el **CPU activo**.

## 2. Qué incluye Hobby, al mes

| Recurso | Incluido | Riesgo aquí |
|---|---|---|
| **CPU activo** | **4 CPU-horas** | **El más ajustado** |
| Invocaciones de función | 1.000.000 | Middleware las multiplica |
| Edge Requests | 1.000.000 | Igual |
| Memoria aprovisionada | 360 GB-horas | Holgado |
| Ancho de banda | 100 GB | Holgado |
| Transformaciones de imagen | 5.000 | Se agota rápido con `next/image` |
| Lecturas de caché de imagen | 300.000 | |
| Duración máxima de función | 300 s | Irrelevante aquí |
| Despliegues por día | 100 | Holgado |
| Compilaciones concurrentes | 1 | |
| **Retención de logs de ejecución** | **1 hora** | Depurar producción es casi a ciegas |
| Reglas WAF / bloqueo de IP | 3 y 3 | Poco margen ante bots |

**Cron jobs: solo frecuencia diaria.** Cualquier expresión más frecuente que una
vez al día falla en el momento del despliegue. Esta es la limitación que más
condiciona la arquitectura.

### Supabase gratis

| Recurso | Límite | Riesgo |
|---|---|---|
| Base de datos | 500 MB | Ninguno: una reserva con su pago ronda 1 KB |
| Almacenamiento | 1 GB | **Comprobantes de pago** |
| Egreso | 5 GB/mes | Servir imágenes desde ahí |
| Usuarios activos/mes | 50.000 | Ninguno: se reserva sin cuenta |
| Proyectos activos | 2 | Producción y pruebas |
| **Pausa por inactividad** | **7 días sin peticiones API** | Ver regla 3.2 |

### Resend gratis

3.000 correos al mes, 100 al día, un dominio propio. Una posada envía decenas al
día. Sobra margen mientras no haya envíos masivos de promoción.

## 3. Reglas de ingeniería

Cada una existe porque un límite concreto la obliga.

### 3.1 El trabajo programado vive en Postgres, no en Vercel

*Motivo: los cron de Hobby solo admiten frecuencia diaria.*

`expire_stale_bookings()` necesita correr cada 15 minutos para liberar fechas de
carritos abandonados. En Hobby eso es imposible: un cron cada 15 minutos ni
siquiera compila.

Solución: **pg_cron dentro de Supabase**. Corre en la base, no consume
invocaciones de Vercel, no depende del plan de hosting y sigue funcionando igual
cuando se pase a Pro.

El alimentador de tasa BCV sí encaja en un cron diario de Vercel — es
exactamente la frecuencia que Hobby permite, y **es la frecuencia correcta, no
un recorte**: la tasa oficial es un promedio ponderado que el BCV publica una
vez al día y que no varía durante la jornada. Leerla más seguido no daría un
solo decimal más de precisión.

Donde sí se pierde dinero es en la ventana entre cotizar y cobrar (la tasa se
mueve ~0,45% al día), y eso se resuelve caducando el monto en bolívares, no
consultando más. Ver `ARCHITECTURE.md`, sección de dinero.

Configurado en `vercel.json` a las **21:30 UTC = 17:30 hora de Venezuela**, con
la ventana de publicación del BCV (4 a 5 de la tarde) ya cerrada. Corre los siete
días de la semana: aunque el BCV no publique sábados ni domingos, la escritura
diaria es lo que mantiene vivo el proyecto de Supabase.

El endpoint `/api/cron/bcv-rate` está protegido con `CRON_SECRET` y comparación
de tiempo constante. Devuelve 200 incluso cuando no logra obtener la tasa: la
corrida ya tocó la base —que es el objetivo secundario— y reintentar no hará que
el BCV publique. El resultado real va en el cuerpo y queda en `rate_fetch_log`.

### 3.2 Algo debe tocar la base de datos a diario

*Motivo: Supabase pausa los proyectos gratuitos tras 7 días sin peticiones API.*

Una posada puede pasar una semana sin reservas en temporada baja. Si el proyecto
se pausa, la web queda caída justo cuando llegue el primer visitante tras la
sequía.

El alimentador de tasa BCV (`scripts/fetch-bcv-rate.mjs`) ya escribe en la base
todos los días, así que **resuelve la pausa como efecto secundario**. Por eso su
ejecución diaria no es opcional: es lo que mantiene el proyecto vivo.

### 3.3 El middleware solo corre donde hace falta

*Motivo: 1.000.000 de invocaciones y 4 CPU-horas.*

Un middleware con matcher amplio se ejecuta en **cada** petición, incluidas las
de páginas públicas que no necesitan sesión. Cada ejecución es una invocación más
y valida el token contra Supabase, que además añade latencia.

El matcher se restringe a `/admin` y a las rutas de autenticación. Las páginas
públicas no pasan por él. Esto reduce las invocaciones aproximadamente a la mitad
del tráfico y elimina una llamada de red por visita.

### 3.4 Las páginas públicas se cachean

*Motivo: 4 CPU-horas es el recurso más ajustado.*

4 CPU-horas son 14.400 segundos de CPU al mes. El tiempo de espera de base de
datos no cuenta —solo el renderizado—, pero un rastreador indexando el sitio a
diario puede consumirlas sin que haya un solo huésped real.

- El home usa `revalidate = 300`. Se mantiene.
- El listado y el detalle son dinámicos porque dependen de las fechas buscadas,
  pero la versión **sin** parámetros de búsqueda debe poder cachearse.
- Nada de `force-dynamic` en rutas públicas que no lo necesiten.

### 3.5 Sin optimización de imágenes de Vercel

*Motivo: 5.000 transformaciones al mes.*

Cuatro unidades con seis fotos en tres tamaños ya son 72 transformaciones, y cada
variante de dispositivo genera más. Se agota antes de lo que parece, y al
agotarse las imágenes dejan de servirse durante 30 días.

Las imágenes se suben ya redimensionadas y se sirven estáticas. Nada de
`next/image` con optimización en servidor.

### 3.6 Los comprobantes se comprimen antes de subir

*Motivo: 1 GB de Storage en Supabase.*

Una captura de un pago móvil pesa entre 0,5 y 2 MB. Sin tratamiento, 1 GB se
agota en unos mil comprobantes — dos o tres años de operación — y luego la app
deja de aceptar pagos.

- Redimensionar en el navegador: lado mayor 1.280 px.
- Convertir a WebP con calidad 0,7.
- Rechazar en el servidor cualquier archivo por encima de 300 KB.

Un comprobante así pesa entre 80 y 150 KB, y el mismo gigabyte dura más de diez
años.

### 3.7 El navegador no consulta en bucle

*Motivo: invocaciones y CPU.*

Sin sondeo para «ver si el pago fue aprobado», sin refrescos automáticos en el
panel. El estado se actualiza al navegar o al enviar un formulario.

Si más adelante hace falta tiempo real, se usa Supabase Realtime —websocket
contra la base, fuera del presupuesto de Vercel— y no peticiones repetidas.

### 3.8 Toda lista se pagina

*Motivo: CPU de renderizado.*

Reservas, histórico de pagos y calendario tienen tope. El calendario ya está
acotado a 45 días por vista; reservas y pagos necesitan el mismo tratamiento
cuando se construyan.

### 3.9 Los eventos importantes se registran en la base

*Motivo: Hobby retiene solo 1 hora de logs de ejecución.*

Un `console.log` desaparece en una hora. Cuando haya que reconstruir por qué se
aprobó o rechazó un pago, o si el cron lleva días fallando en silencio, esa
información tiene que estar en Postgres.

- `payments` guarda `reviewed_by`, `reviewed_at` y `rejection_reason`.
- `rate_fetch_log` guarda cada corrida del cron, con qué dijo cada fuente.

`rate_fetch_log` se poda a 90 días desde la propia corrida del cron, para no
crecer sin techo contra los 500 MB del plan gratuito. Podarla ahí evita un
segundo cron, que Hobby no permitiría de todos modos.

### 3.10 El despliegue de desarrollo va protegido

*Motivo: bots, y el marco de uso no comercial.*

Hobby incluye **Vercel Authentication** como protección de despliegue. Activarlo
en el proyecto de desarrollo:

- impide que rastreadores quemen CPU e invocaciones,
- mantiene el entorno privado mientras no haya nada real que mostrar,
- refuerza que se trata de un entorno de desarrollo, no de un negocio en
  operación.

## 4. Antes de salir a producción real

El plan Hobby restringe el uso a **no comercial y personal**. Vercel define uso
comercial de forma amplia e incluye explícitamente procesar pagos y reservar
citas.

Mientras el proyecto esté en desarrollo —despliegue protegido, sin huéspedes
reales, sin dinero moviéndose— no hay conflicto. **El día que se abra al público
y entre la primera reserva real, sí lo hay**, y hay que resolverlo antes de ese
momento, no después.

Dos salidas, ambas ya contempladas:

| Opción | Costo | Nota |
|---|---|---|
| **Vercel Pro** | 20 USD/mes | Cero migración. Los límites suben ~10× |
| **Cloudflare Workers** | 0 USD | Permite uso comercial en plan gratuito. Requiere adaptador OpenNext |

Como todo se construyó contra los límites de Hobby, cualquiera de las dos es un
cambio de configuración, no un rediseño.

**Lista de verificación previa al lanzamiento:**

- [ ] Decidir plataforma: Vercel Pro o Cloudflare Workers
- [ ] Retirar la protección de despliegue del entorno público
- [ ] Rotar todas las credenciales
- [ ] Confirmar que `expire_stale_bookings()` corre en pg_cron
- [ ] Confirmar que el alimentador de tasa BCV corre a diario
- [ ] Política de retención de comprobantes activa

## 5. Vigilancia

Revisión mensual, cinco minutos, en el panel de uso de Vercel y Supabase:

| Señal | Umbral de atención | Acción |
|---|---|---|
| CPU activo de Vercel | 2 de 4 CPU-horas | Revisar qué ruta renderiza de más |
| Invocaciones de función | 400.000 de 1.000.000 | Revisar matcher del middleware y bots |
| Transformaciones de imagen | 2.000 de 5.000 | Confirmar que no se coló `next/image` |
| Storage de Supabase | 600 MB de 1 GB | Purgar comprobantes antiguos |
| Base de datos | 300 MB de 500 MB | Revisar crecimiento de `gateway_payload` |
| Egreso de Supabase | 3 GB de 5 GB | Verificar que las fotos no salen de ahí |
| Correos de Resend | 2.000 de 3.000 | Buscar reintentos duplicados |

**Retención de comprobantes:** las imágenes de reservas completadas hace más de
12 meses se borran del Storage. La fila del pago se conserva —referencia, monto,
fecha, quién lo aprobó—, que es lo que importa para contabilidad. La captura no
hace falta pasado un año.

## 6. Estado

- [x] Supabase en plan gratuito, dentro de todos los límites
- [x] Resend con dominio propio en plan gratuito
- [x] El alimentador de tasa BCV existe y sirve de latido contra la pausa
- [x] El calendario está acotado a 45 días
- [x] El middleware se restringe a `/admin` y autenticación
- [x] Cron diario de tasa BCV en `vercel.json`, protegido con `CRON_SECRET`
- [x] `rate_fetch_log` con poda a 90 días, contra la retención de 1 hora de logs
- [x] Guardia de tasa rancia: se deja de cotizar antes que cobrar con dato viejo
- [x] Brecha del paralelo visible en el panel, sin intervenir en ningún cobro
- [x] `expire_stale_bookings()` en pg_cron cada 15 minutos
- [x] Compresión de comprobantes en el navegador: 1.280 px, WebP 0,7
- [x] Tope de 300 KB por comprobante validado en el servidor
- [x] Bucket `receipts` privado, sin políticas públicas: nadie sube directo
- [ ] Definir `CRON_SECRET` en las variables de entorno del proyecto en Vercel
- [ ] Activar Vercel Authentication en el despliegue de desarrollo
- [ ] Paginación en las listas de reservas y pagos
