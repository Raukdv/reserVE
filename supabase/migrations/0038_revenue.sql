-- Lo que el negocio ha generado, agregado en la base.
--
-- ## Por qué agregado aquí y no en el navegador
--
-- Traer todas las filas de `payments` para sumarlas en JavaScript funciona con
-- veinte reservas y deja de funcionar con dos mil. El plan Hobby tiene tope de
-- CPU y el plan gratuito de Supabase tiene tope de egreso; sumar en Postgres
-- cuesta una consulta y devuelve doce filas. Ver `COSTO-CERO.md`.
--
-- ## Las cuatro cifras que no son la misma
--
-- | Concepto | Qué es |
-- |---|---|
-- | Cobrado | Todo lo que entró |
-- | IGTF | **No es ingreso.** Se entera al SENIAT |
-- | Impuestos | **Tampoco.** El IVA se recauda por cuenta del fisco |
-- | Devuelto | Salió de la cuenta |
--
-- El ingreso real es `cobrado − devuelto − impuestos`, y el IGTF ni aparece en
-- esa resta: `payments.amount_usd` ya viene neto de IGTF desde la `0024`, así
-- que sumarlo da lo que de verdad pasó a ser del negocio. Se devuelve aparte
-- solo para poder enseñarlo.
--
-- ## La parte de impuesto de un cobro
--
-- Un pago es un trozo del total de una reserva, así que su impuesto es el mismo
-- trozo del impuesto de la reserva. Se reparte en proporción, que es lo que
-- haría cualquiera con el recibo delante.
--
-- Mientras `app_settings.vat_enabled` esté apagado —el valor por defecto— esto
-- da cero siempre, porque no se aplica ningún cargo marcado como impuesto. La
-- cifra existe para cuando se encienda.
--
-- ## El mes es el del negocio
--
-- Postgres corre en UTC y Venezuela va cuatro horas por detrás. Un cobro de las
-- diez de la noche del 31 cae en el mes siguiente si se agrupa en UTC.

create or replace function revenue_by_month(p_months int default 12)
returns table (
  month         date,
  charged_usd   numeric,
  refunded_usd  numeric,
  tax_usd       numeric,
  igtf_usd      numeric,
  net_usd       numeric
)
language sql
stable
as $$
  with movimientos as (
    select
      date_trunc('month', p.paid_at at time zone 'America/Caracas')::date as mes,
      p.kind,
      p.status,
      p.amount_usd,
      p.igtf_usd,
      -- La parte de este movimiento que era impuesto, en proporción.
      case
        when b.total_usd > 0 then round(p.amount_usd * t.tax / b.total_usd, 2)
        else 0
      end as impuesto
    from payments p
    join bookings b on b.id = p.booking_id
    cross join lateral (
      select coalesce(sum((f->>'amount_usd')::numeric), 0) as tax
      from jsonb_array_elements(b.fees_breakdown) f
      where coalesce((f->>'is_tax')::boolean, false)
    ) t
    where p.paid_at is not null
      and p.paid_at >= date_trunc(
            'month', (business_today() - make_interval(months => p_months - 1))
          )
  ),
  meses as (
    select generate_series(
      date_trunc('month', business_today() - make_interval(months => p_months - 1)),
      date_trunc('month', business_today()::timestamp),
      '1 month'
    )::date as mes
  )
  select
    m.mes,
    coalesce(sum(x.amount_usd) filter (where x.status = 'approved'), 0),
    coalesce(sum(x.amount_usd) filter (where x.kind = 'refund' and x.status = 'refunded'), 0),
    coalesce(sum(x.impuesto)   filter (where x.status = 'approved'), 0)
      - coalesce(sum(x.impuesto) filter (where x.kind = 'refund' and x.status = 'refunded'), 0),
    coalesce(sum(x.igtf_usd)   filter (where x.status = 'approved'), 0),
    coalesce(sum(x.amount_usd) filter (where x.status = 'approved'), 0)
      - coalesce(sum(x.amount_usd) filter (where x.kind = 'refund' and x.status = 'refunded'), 0)
      - (coalesce(sum(x.impuesto) filter (where x.status = 'approved'), 0)
         - coalesce(sum(x.impuesto) filter (where x.kind = 'refund' and x.status = 'refunded'), 0))
  from meses m
  left join movimientos x on x.mes = m.mes
  group by m.mes
  order by m.mes;
$$;

comment on function revenue_by_month is
  'Ingreso mensual con los tres descuentos separados: devoluciones, impuestos '
  'recaudados e IGTF. Devuelve todos los meses del rango, con ceros donde no '
  'hubo movimiento, para que la serie no tenga huecos.';

-- ---------------------------------------------------------------------------
-- Por dónde entró
-- ---------------------------------------------------------------------------

create or replace function revenue_by_method(p_month date)
returns table (method payment_method, amount_usd numeric, movimientos int)
language sql
stable
as $$
  select
    p.method,
    sum(p.amount_usd),
    count(*)::int
  from payments p
  where p.status = 'approved'
    and p.paid_at is not null
    and date_trunc('month', p.paid_at at time zone 'America/Caracas')::date
        = date_trunc('month', p_month)::date
  group by p.method
  order by 2 desc;
$$;

comment on function revenue_by_method is
  'Cobros aprobados del mes repartidos por canal. Solo entradas: las '
  'devoluciones no dicen nada sobre por dónde entra el dinero.';

-- ---------------------------------------------------------------------------
-- Ocupación
-- ---------------------------------------------------------------------------

-- Noches vendidas contra noches disponibles. Se cuentan solo las estadías, no
-- los bloqueos: una habitación cerrada por mantenimiento no es una noche
-- vendida, y meterla en el numerador convertiría el indicador en un adorno que
-- sube cuando el negocio va peor.
create or replace function occupancy_for_month(p_month date)
returns jsonb
language sql
stable
as $$
  with rango as (
    select daterange(
      date_trunc('month', p_month)::date,
      (date_trunc('month', p_month) + interval '1 month')::date
    ) as periodo
  ),
  vendidas as (
    select coalesce(sum(
      upper(h.stay * r.periodo) - lower(h.stay * r.periodo)
    ), 0)::int as noches
    from unit_holds h, rango r
    where h.is_active and h.kind = 'booking' and h.stay && r.periodo
  ),
  disponibles as (
    select (
      (select count(*) from units where is_published)
      * (select upper(periodo) - lower(periodo) from rango)
    )::int as noches
  )
  select jsonb_build_object(
    'sold',      v.noches,
    'available', d.noches,
    'ratio',     case when d.noches > 0
                   then round(v.noches::numeric / d.noches, 4)
                   else 0 end
  )
  from vendidas v, disponibles d;
$$;

comment on function occupancy_for_month is
  'Noches vendidas sobre noches disponibles del mes. Solo estadías: un bloqueo '
  'por mantenimiento no es una venta.';
