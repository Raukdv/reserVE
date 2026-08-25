-- El IVA queda apagado por defecto, detrás de un interruptor.
--
-- ## Por qué
--
-- Cobrar IVA no es calcular un porcentaje. Es emitir factura fiscal con
-- correlativo, llevar libro de ventas, y poder emitir notas de crédito para
-- anularla cuando se devuelve dinero. Nada de eso existe aquí, y no está
-- previsto que exista: la facturación fiscal saldría de otro sistema y esta
-- aplicación, como mucho, referenciaría lo que aquel emita.
--
-- Con el IVA aplicándose «de frente» y sin ese respaldo, el sistema asumía una
-- responsabilidad que no puede cumplir:
--
-- - Devolvía el impuesto al huésped sin poder recuperarlo del SENIAT, porque
--   recuperarlo exige la nota de crédito que no se puede emitir. En una
--   cancelación de una reserva de 301,60 eran 41,60 de pérdida real.
-- - Retenía impuesto sobre penalizaciones y no-shows, que según todo lo
--   encontrado son indemnizaciones no sujetas — pendiente de confirmar con un
--   contador, y sin factura tampoco habría forma de corregirlo.
--
-- Apagado, nada de eso ocurre. **El operador decide cómo compone el total de la
-- reserva**, que es cosa suya y de su contabilidad; el sistema se limita a
-- cobrar lo que se le diga y no pretende saber de impuestos.
--
-- ## Qué hace el interruptor
--
-- Encendido, todo funciona como estaba: los cargos marcados `is_tax` se
-- calculan, se cobran y se devuelven en proporción, y `tax_usd` / `net_usd`
-- separan lo recaudado del ingreso.
--
-- Apagado —el valor por defecto— los cargos marcados como impuesto
-- **sencillamente no se aplican**. No aparecen en el desglose, no se cobran y no
-- hay nada que devolver. La marca `is_tax` se conserva en la tabla para que
-- encender el interruptor no obligue a reconfigurar nada.
--
-- ## Lo ya cobrado no se toca
--
-- El desglose vive congelado en `bookings.fees_breakdown`. Una reserva cobrada
-- con IVA lo conserva y se devuelve como siempre. El interruptor gobierna lo que
-- se cotiza de aquí en adelante, no lo que ya ocurrió.

alter table app_settings
  add column if not exists vat_enabled boolean not null default false;

comment on column app_settings.vat_enabled is
  'Si el sistema aplica los cargos marcados como impuesto. Apagado por defecto: '
  'cobrar IVA exige factura fiscal, libro de ventas y notas de crédito, y nada '
  'de eso existe aquí. Apagado, esos cargos no se calculan ni se cobran.';

-- ---------------------------------------------------------------------------
-- El cálculo lo respeta
-- ---------------------------------------------------------------------------

create or replace function compute_fees(
  p_unit_id  uuid,
  p_nights   integer,
  p_guests   integer,
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
  v_tax    numeric(12, 2) := 0;
  v_vat    boolean;
begin
  select coalesce(vat_enabled, false) into v_vat from app_settings;

  -- Primera pasada: montos.
  --
  -- El filtro `not is_tax or v_vat` deja fuera los tributos cuando el
  -- interruptor está apagado. Se filtra aquí y no al final a propósito: un
  -- impuesto excluido tampoco debe engordar la base de los porcentajes.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind <> 'percent'
       and (not is_tax or v_vat)
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
      if v_fee.is_tax then v_tax := v_tax + v_amount; end if;

      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', v_fee.kind,
        'rate', v_fee.amount, 'amount_usd', v_amount,
        'refundable', v_fee.refundable, 'is_tax', v_fee.is_tax, 'scope',
        case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  -- Segunda pasada: porcentajes sobre la base ya formada.
  --
  -- Ojo: la base es el subtotal más los cargos de monto, así que un porcentaje
  -- no grava a otro porcentaje. Para el IVA sobre la limpieza está bien; si
  -- alguna vez se crea un recargo de temporada como porcentaje, el IVA no caerá
  -- sobre él. Se deja como estaba: cambiarlo cambiaría lo que se cobra.
  for v_fee in
    select * from fees
     where is_active
       and (unit_id is null or unit_id = p_unit_id)
       and kind = 'percent'
       and (not is_tax or v_vat)
     order by unit_id nulls first, sort_order, name
  loop
    v_amount := round(v_base * v_fee.amount / 100.0, 2);

    if v_amount > 0 then
      v_total := v_total + v_amount;
      if v_fee.is_tax then v_tax := v_tax + v_amount; end if;

      v_items := v_items || jsonb_build_object(
        'id', v_fee.id, 'name', v_fee.name, 'kind', 'percent',
        'rate', v_fee.amount, 'amount_usd', v_amount,
        -- Un porcentaje sigue a su base: se reembolsa en proporción a lo que
        -- se reembolse de ella, sin bandera propia.
        'refundable', true,
        'is_tax', v_fee.is_tax,
        'base_usd', v_base,
        'scope', case when v_fee.unit_id is null then 'general' else 'unit' end
      );
    end if;
  end loop;

  return jsonb_build_object(
    'items',     v_items,
    'total_usd', v_total,
    'tax_usd',   v_tax,
    'base_usd',  v_base
  );
end;
$$;

comment on function compute_fees is
  'Desglose de cargos de una estadía. Los cargos marcados como impuesto solo '
  'entran si app_settings.vat_enabled está encendido. Devuelve items, '
  'total_usd, tax_usd y base_usd.';
