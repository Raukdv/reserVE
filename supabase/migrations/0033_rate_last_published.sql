-- La tasa vigente es la última publicada, no la última con fecha valor cumplida.
--
-- ## Qué estaba mal
--
-- `current_rate()` filtraba por `rate_date <= business_today()`. La idea era que
-- una tasa con fecha valor futura «todavía no rige». Es falso.
--
-- El BCV abre sobre las 7:00 y cierra entre las 18:00 y las 20:00 VET. Lo que
-- publica al cerrar el viernes lleva fecha valor del lunes — y desde ese
-- instante es la tasa legal. No empieza a regir el lunes: rige ya.
--
-- Con el filtro viejo, el sábado y el domingo se cotizaba con el cierre del
-- jueves, que a esas alturas el BCV ya había reemplazado dos veces. En la brecha
-- del 2026-08-21 eso eran 779,9522 en vez de 784,6633: casi un 0,6 % de menos
-- en cada reserva de fin de semana.
--
-- ## La regla
--
-- La última publicada rige, sea de mañana, tarde o noche. El sábado y el domingo
-- se cotizan con el último cierre del viernes hasta que el BCV vuelve a abrir el
-- lunes. Como el BCV publica en orden de fecha valor creciente, «la última
-- publicada» es la de `rate_date` mayor, sin más.
--
-- Esto traslada toda la responsabilidad al alimentador: si no leemos después de
-- que el BCV cierre, cobramos con una tasa que ya no es la legal. La frecuencia
-- de lectura deja de ser comodidad y pasa a ser cumplimiento.

create or replace function current_rate()
returns numeric
language sql stable
as $$
  select usd_ves
  from exchange_rates
  where market = 'oficial'
  order by rate_date desc
  limit 1;
$$;

comment on function current_rate() is
  'Tasa oficial legalmente vigente: la última publicada por el BCV, tenga la '
  'fecha valor que tenga. Nunca el paralelo — Ley de Precios Justos.';

create or replace function current_rate_date()
returns date
language sql stable
as $$
  select rate_date
  from exchange_rates
  where market = 'oficial'
  order by rate_date desc
  limit 1;
$$;

comment on function current_rate_date() is
  'Fecha valor de la tasa vigente. Puede ser futura: la publicada el viernes al '
  'cierre lleva fecha del lunes y rige desde que se publica.';

-- Con fecha valor futura la resta sale negativa y nunca da obsoleto, que es lo
-- correcto. El margen de tres días sigue cubriendo el fin de semana largo y
-- sigue delatando al alimentador caído, solo que contando desde una fecha que
-- ahora puede ir por delante del calendario.
comment on function rate_is_stale() is
  'Cierto si la tasa vigente tiene más de 3 días de fecha valor, o si no hay '
  'ninguna. Con fecha valor futura da falso. Delata un alimentador caído.';
