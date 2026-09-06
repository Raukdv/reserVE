-- El código de reserva pasa a base32 de Crockford, de diez caracteres.
--
-- ## Por qué se cambia
--
-- El código es la **única credencial** de la página del huésped: quien lo tenga
-- ve la reserva. No hay sesión detrás, y no la va a haber — pedir registro para
-- reservar pierde reservas.
--
-- Eran ocho caracteres hexadecimales, o sea 32 bits. Dos problemas:
--
-- - **Enumerable.** 4.300 millones de combinaciones es mucho para adivinar una
--   concreta y poco para recorrer con un script. Y `/reserva/[code]` no limita
--   intentos. Mientras el sitio esté tras la puerta de acceso no hay exposición;
--   al abrirlo, sí.
-- - **Colisiones.** Con la paradoja del cumpleaños, diez mil reservas sobre 2³²
--   dan un 1,2 % de probabilidad de que dos compartan código. La restricción
--   `unique` lo convertiría en un error al crear la reserva, delante del
--   huésped.
--
-- Diez caracteres de base32 son **50 bits**: 1,1 billones de combinaciones. Con
-- las mismas diez mil reservas, la probabilidad de colisión baja a una entre
-- veinte millones.
--
-- ## Por qué base32 y no doce hexadecimales
--
-- Doce hex también dan 48 bits, pero cuatro caracteres más que dictar por
-- teléfono. El código se lee en voz alta más de lo que parece: la reserva se
-- toma por WhatsApp o llamada y el operador se lo canta al huésped.
--
-- El alfabeto de Crockford es `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — **sin I, L,
-- O ni U**. No hay confusión entre uno y ele, ni entre cero y o, que es
-- justamente lo que rompe un código dictado. Y la U se quita para que el azar no
-- componga palabrotas.
--
-- Resultado: más entropía en menos caracteres, y más fáciles de leer.
--
--     antes   C950D7DA        32 bits
--     ahora   TRWD0MASAJ      50 bits
--
-- ## Los códigos viejos siguen valiendo
--
-- La columna es `text` sin longitud máxima y nadie asume ocho caracteres. Las
-- reservas ya emitidas resuelven igual; el cambio solo afecta a las nuevas. Y
-- como `A–F` están dentro del alfabeto de Crockford, un código hexadecimal
-- antiguo sigue siendo base32 válido.

create or replace function booking_code()
returns text
language plpgsql
volatile
-- `gen_random_bytes` es de pgcrypto, que en Supabase vive en `extensions`. Sin
-- fijar el search_path aquí, la función resuelve bien desde una sesión suelta y
-- falla desde dentro de `create_booking()`, que lo fija a `public` — o sea,
-- justo en el único sitio donde de verdad se usa.
set search_path = public, extensions
as $$
declare
  -- Crockford: sin I, L, O ni U.
  v_alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea := gen_random_bytes(10);
  v_out      text := '';
begin
  /*
    Un byte por carácter, y `% 32` reparte sin sesgo porque 256 es múltiplo
    exacto de 32. Con un alfabeto que no divida a 256 habría que descartar los
    valores sobrantes; aquí no hace falta.

    Va en plpgsql y no en SQL a propósito. En una función `language sql`,
    Postgres evalúa `gen_random_bytes()` una sola vez para toda la consulta:
    `select booking_code() from generate_series(1, 500)` devolvía el mismo código
    quinientas veces. Como valor por defecto de columna probablemente bastaría,
    pero un `insert` de varias filas colisionaría contra el `unique`, y eso es
    justo lo que el código no puede hacer.
  */
  for i in 0..9 loop
    v_out := v_out || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  return v_out;
end;
$$;

comment on function booking_code() is
  'Código de reserva: diez caracteres de base32 de Crockford, 50 bits. Sin I, '
  'L, O ni U, para que no se confundan al dictarlo por teléfono.';

alter table bookings alter column code set default booking_code();

comment on column bookings.code is
  'Identificador público de la reserva y única credencial de su página. '
  'Aleatorio, nunca correlativo: uno secuencial convertiría /reserva/[code] en '
  'un directorio de las reservas del negocio.';
