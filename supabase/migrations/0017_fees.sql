-- Cargos: generales y por unidad.
--
-- Hasta ahora solo existía `units.cleaning_fee_usd`, un monto fijo por estadía.
-- No alcanza: un anfitrión no cobra limpieza pero sí piscina, otro cobra por
-- huésped, y el IVA es un porcentaje sobre el total, no un monto.
--
-- Se generaliza en una tabla con dos alcances:
--
--   unit_id null  cargo general, se aplica a todas las unidades (IVA, tasa
--                 turística, recargo de temporada)
--   unit_id       cargo propio de esa unidad (limpieza, piscina, traslado)
--
-- Y cuatro formas de calcularlo. La distinción que importa es que un porcentaje
-- necesita una base, y esa base son las noches más los cargos de monto fijo —
-- igual que el IVA se calcula sobre el valor del servicio, no sobre sí mismo.

create type fee_kind as enum (
  'fixed',      -- monto por estadía
  'per_night',  -- monto x noches
  'per_guest',  -- monto x huéspedes
  'percent'     -- porcentaje sobre la base
);

create table fees (
  id      uuid primary key default gen_random_uuid(),

  -- Null = general, a todas las unidades. Con valor = solo a esa.
  unit_id uuid references units(id) on delete cascade,

  name    text not null,
  kind    fee_kind not null,

  -- Monto en USD, o porcentaje si kind = 'percent'.
  amount  numeric(10, 3) not null check (amount >= 0),

  -- Se muestra al huésped bajo el nombre del cargo.
  description text,

  /*
    Si vuelve en una cancelación parcial.

    La limpieza no se devuelve una vez que el equipo ya se preparó; un depósito
    reembolsable sí. Los cargos de porcentaje ignoran esta bandera: un impuesto
    sigue a la base, así que se recalcula sobre lo que efectivamente se reembolsa.
  */
  refundable boolean not null default false,

  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index on fees (unit_id, is_active, sort_order);

alter table fees enable row level security;

-- Lectura pública: el huésped tiene que ver el desglose antes de reservar.
create policy fees_read on fees for select using (is_active or is_staff());
create policy fees_write on fees for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- La limpieza existente pasa a ser un cargo
-- ---------------------------------------------------------------------------

insert into fees (unit_id, name, kind, amount, refundable, sort_order)
select id, 'Limpieza', 'fixed', cleaning_fee_usd, false, 0
from units
where cleaning_fee_usd > 0;

-- ---------------------------------------------------------------------------
-- Cálculo
-- ---------------------------------------------------------------------------

-- Devuelve el desglose y el total.
--
-- Orden deliberado: primero los cargos de monto, que junto a las noches forman
-- la base; después los porcentajes sobre esa base. Al revés, el IVA no gravaría
-- la limpieza, que es justo lo que la ley sí grava.
create or replace function compute_fees(
  p_unit_id  uuid,
  p_nights   int,
  p_guests   int,
  p_subtotal numeric
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_fee    record;
  v_amount numeric(12, 2);
  v_base   numeric(12, 2) := p_subtotal;
  v_items  jsonb := '[]'::jsonb;
  v_total  numeric(12, 2) := 0;
begin
  -- Primera pasada: montos.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind <> 'percent'
     order by unit_id nulls first, sort_order, name
  loop
    v_amount := round(
      case v_fee.kind
        when 'fixed'     then v_fee.amount
        when 'per_night' then v_fee.amount * p_nights
        when 'per_guest' then v_fee.amount * p_guests
      end, 2);

    if v_amount > 0 then
      v_base  := v_base + v_amount;
      v_total := v_total + v_amount;
      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', v_fee.kind,
        'rate', v_fee.amount, 'amount_usd', v_amount,
        'refundable', v_fee.refundable, 'scope',
        case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  -- Segunda pasada: porcentajes sobre la base ya formada.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind = 'percent'
     order by unit_id nulls first, sort_order, name
  loop
    v_amount := round(v_base * v_fee.amount / 100.0, 2);

    if v_amount > 0 then
      v_total := v_total + v_amount;
      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', 'percent',
        'rate', v_fee.amount, 'amount_usd', v_amount,
        -- Un porcentaje sigue a su base: se reembolsa en proporción a lo que
        -- se reembolse de ella, sin bandera propia.
        'refundable', true,
        'base_usd', v_base,
        'scope', case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  return jsonb_build_object('items', v_items, 'total_usd', v_total, 'base_usd', v_base);
end;
$$;

-- ---------------------------------------------------------------------------
-- La reserva guarda el desglose
-- ---------------------------------------------------------------------------

-- Los cargos cambian con el tiempo; lo cobrado no. Se congela igual que la tasa.
alter table bookings
  add column if not exists fees_usd numeric(12, 2) not null default 0,
  add column if not exists fees_breakdown jsonb not null default '[]'::jsonb;

comment on column bookings.fees_breakdown is
  'Desglose de cargos tal como se aplicaron al reservar. Se congela: cambiar un '
  'cargo no debe alterar lo ya cobrado.';

-- Lo que había en cleaning_fee_usd pasa al nuevo modelo.
update bookings
   set fees_usd = cleaning_fee_usd,
       fees_breakdown = jsonb_build_array(jsonb_build_object(
         'name', 'Limpieza', 'kind', 'fixed', 'rate', cleaning_fee_usd,
         'amount_usd', cleaning_fee_usd, 'refundable', false, 'scope', 'unit'
       ))
 where cleaning_fee_usd > 0 and fees_usd = 0;
