# Acceso y roles

Quién puede ver qué, quién puede escribir qué, y por qué el huésped no necesita
cuenta para nada.

---

## Tres capas, tres cosas distintas

| Capa | Qué protege | Cómo |
|---|---|---|
| **Puerta del sitio** | El sitio entero durante el desarrollo | `SITE_PASSWORD` en el middleware |
| **Sesión y rol** | El panel | Supabase Auth + `profiles.role` |
| **RLS** | Los datos | Políticas en cada tabla |

Se confunden con facilidad, así que conviene el orden: la puerta es una cortina,
la sesión es la cerradura, y la RLS es lo que impide que una consulta traiga
filas que no le tocan aunque las dos anteriores se salten.

---

## La puerta: una cortina, no seguridad

Vercel protege los previews y las URLs `*.vercel.app`, pero **no el dominio
propio en producción** salvo en el plan Pro. El middleware lo cubre con
autenticación básica:

```ts
if (password && !isMachineEndpoint && !passesGate(request, password)) {
  return gateResponse()   // 401 + WWW-Authenticate
}
```

Es una barrera contra visitantes casuales y rastreadores, **no seguridad de
verdad**: la contraseña se comparte y viaja en cada petición. Lo que protege el
panel sigue siendo la sesión con su comprobación de rol.

Se activa solo si `SITE_PASSWORD` existe. Al abrir al público se borra la
variable y la puerta desaparece sin tocar código.

Mientras esté puesta, todas las respuestas llevan `X-Robots-Tag: noindex,
nofollow`. Una URL privada indexada deja de ser privada.

### Los endpoints de máquina se saltan la puerta

```ts
const isMachineEndpoint =
  path.startsWith('/api/webhooks/') || path.startsWith('/api/cron/')
```

Stripe no puede mandar `Authorization: Basic`, y el sondeo de tasa manda su
propio Bearer. No es un agujero: los dos llevan autenticación más fuerte que la
puerta —firma HMAC uno, `CRON_SECRET` el otro—. Ver `tasa-bcv-y-bimoneda.md`.

### El `matcher` cubre el sitio entero, y eso es temporal

```
'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|...)$).*)'
```

Tiene que cubrirlo todo para que la puerta sirva. Cuando desaparezca
`SITE_PASSWORD` conviene volver a `/admin/:path*`: una invocación de middleware
por visita pública es cuota desperdiciada. Ver la regla 3.3 de `COSTO-CERO.md` y
`PENDIENTES.md`.

---

## `getUser()`, nunca `getSession()`

```ts
// getUser() valida el token contra Supabase; getSession() solo lee la cookie y
// se puede falsificar. En middleware siempre getUser().
const { data: { user } } = await supabase.auth.getUser()
```

`getSession()` decodifica la cookie y devuelve lo que ponga dentro. Cualquiera
puede escribir una cookie. `getUser()` cuesta una llamada y a cambio la respuesta
es verdad.

Sin usuario, redirección a `/login` con `?next=` para volver donde se iba. Con
usuario pero sin rol de personal, redirección al inicio: no un 403, porque decir
«existe pero no puedes» es información que no hace falta dar.

---

## Tres roles, y el que importa es uno

```
admin · staff · guest
```

`guest` es el valor por defecto de la columna. `handle_new_user()` crea el perfil
al registrarse un usuario y **no toca el rol**, así que toda cuenta nueva nace
sin acceso al panel. Promover a `staff` o `admin` es una operación manual sobre
la base, a propósito: no hay pantalla para darse permisos a uno mismo.

Hoy `admin` y `staff` **no se distinguen en ningún sitio**. `is_staff()` acepta
los dos y no hay ninguna comprobación que pida `admin`. La separación está
puesta para cuando haga falta —un empleado que registra cobros pero no cambia
precios— y hasta entonces es solo una etiqueta.

---

## `is_staff()` es la pieza que sostiene la RLS

```sql
create function is_staff() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;
```

`security definer` no es opcional aquí. La consulta lee `profiles`, que tiene su
propia RLS; sin `definer` la comprobación de permisos necesitaría permisos, y se
muerde la cola.

`set search_path = public` tampoco: una función `definer` sin `search_path` fijo
es la vía clásica para que alguien anteponga un esquema con su propia tabla
`profiles`.

---

## El patrón de las políticas

Casi todas las tablas siguen la misma forma:

```sql
create policy x_read  on x for select using (<condición pública> or is_staff());
create policy x_write on x for all    using (is_staff()) with check (is_staff());
```

Lo que cambia es la condición pública:

| Tabla | Quién lee sin sesión |
|---|---|
| `units` | `is_published` |
| `fees` | `is_active` — el huésped ve el desglose antes de reservar |
| `season_rates`, `exchange_rates`, `amenities`, `site_content`, `site_media`, `unit_media` | Todos |
| `bookings` | `guest_id = auth.uid()` |
| `payments` | Los de una reserva propia |
| `profiles` | El propio |
| `email_log`, `rate_fetch_log` | Nadie: solo personal |

Que las tarifas y las tasas sean de lectura pública es deliberado: la web pública
consulta sin sesión y el precio no es un secreto. Lo que no puede leer nadie de
fuera son las bitácoras, donde hay correos y errores de integración.

---

## El huésped no tiene cuenta

Y no la va a tener. Reservar pidiendo registro pierde reservas.

La reserva se identifica por su **código**, y la página del huésped es
`/reserva/[CÓDIGO]`. Los datos salen de `get_booking(p_code)`, que es
`security definer`: se salta la RLS a propósito porque quien la llama es un
anónimo con un código.

Eso hace del código una credencial, así que se genera al azar y no en serie: uno
correlativo convertiría la página en un directorio de las reservas del negocio,
porque bastaría sumar uno.

Son **diez caracteres de base32 de Crockford**, 50 bits, sobre bytes
criptográficos:

```
TRWD0MASAJ    YY8X9WJXHW    R439B5YJ2P
```

Eran ocho hexadecimales —32 bits— hasta la migración `0039`, y se cambiaron por
dos motivos que no son el mismo:

- **Enumeración.** 4.300 millones es mucho para adivinar uno concreto y poco para
  recorrer con un script, y `/reserva/[code]` no limita intentos. Con la puerta
  de acceso puesta no había exposición; al abrir al público, sí.
- **Colisiones.** Por la paradoja del cumpleaños, diez mil reservas sobre 2³²
  daban un 1,2 % de probabilidad de que dos compartieran código. La restricción
  `unique` lo habría convertido en un error al reservar, delante del huésped. Con
  50 bits baja a una entre veinte millones.

### El alfabeto se eligió por el teléfono

Doce hexadecimales daban los mismos 48 bits, pero el código **se dicta en voz
alta**: la reserva se toma por WhatsApp o llamada y el operador se lo canta al
huésped. Crockford usa `0123456789ABCDEFGHJKMNPQRSTVWXYZ` —sin `I`, `L`, `O` ni
`U`—, así que no hay confusión entre uno y ele ni entre cero y o. Más entropía en
menos caracteres, y más fáciles de leer.

La otra mitad de Crockford es que **al leer se perdona lo que se confunde al
escribir**: `normalizeBookingCode()` mapea `O` a cero, `I` y `L` a uno, y quita
guiones y espacios. Vive en TypeScript y se aplica solo en la frontera del
huésped —la ruta y el formulario—, no en las quince funciones de Postgres que
buscan por código: los caminos del personal reciben el código de un enlace, nunca
del teclado, y varias de esas funciones mueven dinero.

Los códigos antiguos siguen valiendo. La columna es `text` sin longitud máxima, y
como `A–F` están dentro del alfabeto de Crockford, un hexadecimal viejo es base32
válido y la normalización lo deja intacto.

`bookings.guest_id` existe y la política `bookings_own` lo usa, pero es para el
día que haya cuentas de huésped. Hoy está en nulo y el camino real es el código.

### La cadena del reporte de pago

`payments_own_insert` permite insertar sin sesión. No es tan abierto como suena:
`report_payment()` exige el código de la reserva, valida el monto contra lo que
falta y guarda el comprobante en un bucket privado. Ver
`cobro-y-verificacion.md`.

---

## El cliente de servicio existe y hay que tratarlo con respeto

`createAdminClient()` usa `SUPABASE_SECRET_KEY` y **se salta la RLS entera**. Se
usa donde no hay sesión que valga: el cron, los webhooks, el borrado de archivos
huérfanos del almacenamiento.

No lleva cookies ni sesión persistente, para que no pueda heredar por accidente
la identidad de nadie:

```ts
cookies: { getAll: () => [], setAll: () => {} },
auth: { persistSession: false, autoRefreshToken: false },
```

La clave nunca sale del servidor. Si aparece en un archivo con `'use client'` o
con prefijo `NEXT_PUBLIC_`, el problema es grave y no hay atenuante. Ver
`VARIABLES.md`.

---

## Comprobado

```
ok   función is_staff()
ok   RLS activo en todas las tablas
ok   bucket receipts existe y es privado
```

La primera comprobación es que **ninguna tabla se queda sin RLS**, no que las
políticas sean correctas. Una tabla nueva sin `enable row level security` es
legible por cualquiera con la clave pública, y es un olvido fácil: la migración
funciona igual.

---

## Lo que no cubre

**`admin` y `staff` no se diferencian.** Explicado arriba.

**No hay registro de quién hizo qué.** `site_content.updated_by` es lo más
parecido. Quién confirmó una reserva, quién aprobó un pago o quién cambió un
precio no queda anotado. Para un negocio de una persona da igual; con dos
empleados, no.

**No hay segundo factor** ni política de contraseñas más allá de la de Supabase.

**La puerta comparte una sola contraseña.** No hay usuarios; el nombre se ignora
y solo se compara la contraseña. Es coherente con lo que es —una cortina— pero
significa que no se puede revocar el acceso a una persona sin cambiársela a
todas.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Puerta y comprobación de rol | `src/middleware.ts` |
| Perfiles y roles | `profiles`, `user_role`, migración `0001` |
| Perfil al registrarse | `handle_new_user()`, disparador sobre `auth.users` |
| Comprobación de personal | `is_staff()` |
| Clientes de Supabase | `src/lib/supabase/server.ts` |
| Acceso del huésped por código | `get_booking()`, migración `0004` |
| Entrada al panel | `/login` |
| Contraseña de la puerta | `SITE_PASSWORD`, ver `VARIABLES.md` |
