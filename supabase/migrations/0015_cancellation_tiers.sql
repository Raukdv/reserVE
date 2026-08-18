-- Política de cancelación por tramos, y horarios de entrada y salida.
--
-- Hasta ahora la política era un texto libre igual para todos: «gratuita hasta 7
-- días antes...». El huésped tenía que hacer la cuenta mental sobre sus propias
-- fechas, y el operador no tenía forma de saber cuánto devolver al cancelar.
--
-- Pasa a ser una escalera de tramos. Cada uno dice cuántas horas antes de la
-- llegada vence y qué porcentaje se reembolsa. Con eso se pueden mostrar fechas
-- y horas reales para cada reserva, y calcular el reembolso exacto.

-- ---------------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------------

-- Sin hora de entrada no hay plazo que calcular: «7 días antes» de qué momento.
alter table app_settings
  add column if not exists check_in_time  time not null default '13:00',
  add column if not exists check_out_time time not null default '11:00';

comment on column app_settings.check_in_time is
  'Hora de llegada en la zona del negocio. Es el instante desde el que se miden '
  'los plazos de cancelación.';

-- ---------------------------------------------------------------------------
-- Tramos
-- ---------------------------------------------------------------------------

-- Forma: [{"hours_before": 168, "refund_percent": 100}, ...]
--
-- Ordenados de mayor a menor antelación. Se aplica el primero cuya antelación
-- todavía se cumple; si no se cumple ninguno, no hay reembolso.
--
-- Se guarda en jsonb y no en una tabla aparte porque son dos o tres filas que
-- solo tienen sentido juntas y siempre se leen enteras. Una tabla añadiría un
-- join a cada cotización a cambio de nada.
alter table app_settings
  add column if not exists cancellation_tiers jsonb not null default
    '[{"hours_before": 168, "refund_percent": 100},
      {"hours_before": 72,  "refund_percent": 50}]'::jsonb;

comment on column app_settings.cancellation_tiers is
  'Escalera de reembolso, de mayor a menor antelación. hours_before se mide '
  'desde la hora de entrada. Lo no cubierto por ningún tramo no se reembolsa.';

comment on column app_settings.cancellation_policy is
  'Notas adicionales en texto libre. Los plazos y porcentajes salen de '
  'cancellation_tiers; esto es para matices que no caben en una escalera.';

-- El texto sembrado describía justo la escalera por defecto, así que dejarlo
-- duplicaría la información. Se conserva solo si alguien escribió otra cosa.
update app_settings
   set cancellation_policy = null
 where cancellation_policy like 'Cancelación gratuita hasta 7 días%';

-- ---------------------------------------------------------------------------
-- Reembolso de una reserva
-- ---------------------------------------------------------------------------

-- Devuelve qué correspondería devolver si se cancelara ahora mismo.
--
-- La base es lo efectivamente cobrado, no el total de la reserva: nadie devuelve
-- dinero que nunca recibió.
create or replace function cancellation_quote(p_code text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_booking  bookings%rowtype;
  v_settings app_settings%rowtype;
  v_deadline timestamptz;
  v_paid     numeric(12, 2);
  v_percent  int := 0;
  v_tier     jsonb;
begin
  select * into v_booking from bookings where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_settings from app_settings;

  select coalesce(sum(amount_usd), 0) into v_paid
  from payments where booking_id = v_booking.id and status = 'approved';

  -- La llegada, en la zona del negocio, convertida a instante absoluto.
  v_deadline := (v_booking.check_in + v_settings.check_in_time)
                  at time zone 'America/Caracas';

  -- Se recorre de mayor a menor antelación y se toma el primero que aún se
  -- cumple. El orden lo garantiza la propia lista.
  for v_tier in
    select value from jsonb_array_elements(v_settings.cancellation_tiers)
     order by (value->>'hours_before')::numeric desc
  loop
    if now() <= v_deadline - make_interval(hours => (v_tier->>'hours_before')::int) then
      v_percent := (v_tier->>'refund_percent')::int;
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',            true,
    'paid_usd',      v_paid,
    'refund_percent', v_percent,
    'refund_usd',    round(v_paid * v_percent / 100.0, 2),
    'check_in_at',   v_deadline
  );
end;
$$;

revoke all on function cancellation_quote from public;
grant execute on function cancellation_quote to anon, authenticated;
