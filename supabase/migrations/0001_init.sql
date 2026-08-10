-- reserVE — esquema inicial
-- Ver docs/ARCHITECTURE.md para el razonamiento detrás de estas decisiones.

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- requerido por el EXCLUDE de unit_holds

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------

create type user_role as enum ('admin', 'staff', 'guest');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role   not null default 'guest',
  full_name   text,
  phone       text,
  document_id text,                       -- cédula o RIF
  created_at  timestamptz not null default now()
);

create index on profiles (role);

-- Todo usuario que se registra obtiene un perfil de huésped.
create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Se usa dentro de las políticas RLS. SECURITY DEFINER para evitar recursión
-- cuando la política de una tabla necesita leer profiles.
create function is_staff()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------

create table properties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  address     text,
  city        text,
  latitude    numeric(10, 7),
  longitude   numeric(10, 7),
  timezone    text not null default 'America/Caracas',
  created_at  timestamptz not null default now()
);

create table units (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  description   text,
  max_guests    int  not null default 2 check (max_guests > 0),
  bedrooms      int  not null default 1,
  beds          int  not null default 1,
  bathrooms     numeric(3, 1) not null default 1,

  -- Tarifa por defecto. season_rates la sobreescribe en los rangos que cubra.
  base_price_usd numeric(10, 2) not null check (base_price_usd >= 0),
  cleaning_fee_usd numeric(10, 2) not null default 0 check (cleaning_fee_usd >= 0),

  -- Reglas de estadía
  min_nights        int not null default 1 check (min_nights > 0),
  max_nights        int check (max_nights is null or max_nights >= min_nights),
  advance_notice_days int not null default 0 check (advance_notice_days >= 0),

  is_published  boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index on units (property_id);
create index on units (is_published);

create table unit_media (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references units(id) on delete cascade,
  storage_path text not null,             -- ruta en Supabase Storage
  alt_text   text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index on unit_media (unit_id, sort_order);

create table amenities (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  label text not null,
  icon  text
);

create table unit_amenities (
  unit_id    uuid not null references units(id) on delete cascade,
  amenity_id uuid not null references amenities(id) on delete cascade,
  primary key (unit_id, amenity_id)
);

-- ---------------------------------------------------------------------------
-- Tarifas por temporada
-- ---------------------------------------------------------------------------

create table season_rates (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  name        text not null,
  period      daterange not null,
  price_usd   numeric(10, 2) not null check (price_usd >= 0),
  min_nights  int check (min_nights is null or min_nights > 0),
  created_at  timestamptz not null default now(),

  -- Dos tarifas no pueden cubrir la misma noche de la misma unidad; si no,
  -- el precio de una fecha sería ambiguo.
  constraint season_rates_no_overlap exclude using gist (
    unit_id with =,
    period  with &&
  )
);

create index on season_rates (unit_id);

-- ---------------------------------------------------------------------------
-- Ocupación — el corazón del sistema
-- ---------------------------------------------------------------------------

-- Reservas y bloqueos manuales comparten esta tabla para que una sola restricción
-- EXCLUDE cubra ambos casos. Consultar disponibilidad es una query contra una
-- sola tabla, y Postgres —no la aplicación— garantiza que nada se solape.
--
-- Los rangos son semiabiertos [check_in, check_out): la noche de salida queda
-- libre, así que una salida y una entrada el mismo día no colisionan.

create type hold_kind as enum ('booking', 'block');

create table unit_holds (
  id       uuid primary key default gen_random_uuid(),
  unit_id  uuid not null references units(id) on delete cascade,
  stay     daterange not null,
  kind     hold_kind not null,

  -- Liberar fechas se hace desactivando el hold, no borrándolo: preserva el
  -- historial de cancelaciones y expiraciones.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint unit_holds_bounds check (
    lower_inc(stay) and not upper_inc(stay) and not isempty(stay)
  ),

  constraint unit_holds_no_overlap exclude using gist (
    unit_id with =,
    stay    with &&
  ) where (is_active)
);

create index on unit_holds using gist (unit_id, stay) where is_active;

create table availability_blocks (
  id       uuid primary key default gen_random_uuid(),
  hold_id  uuid not null unique references unit_holds(id) on delete cascade,
  reason   text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tasa de cambio
-- ---------------------------------------------------------------------------

-- Alimentada a diario desde el BCV. Cada reserva congela la tasa que se le
-- aplicó, así que un cambio de tasa nunca reescribe el historial.
create table exchange_rates (
  rate_date  date primary key,
  usd_ves    numeric(18, 6) not null check (usd_ves > 0),
  source     text not null default 'bcv',
  fetched_at timestamptz not null default now()
);

-- Última tasa conocida. Si el scraper del BCV falla, devuelve la anterior en vez
-- de romper el checkout.
create function current_rate()
returns numeric
language sql stable
as $$
  select usd_ves from exchange_rates order by rate_date desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------------

create type booking_status as enum (
  'pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'expired'
);

create table bookings (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  unit_id  uuid not null references units(id),
  hold_id  uuid not null unique references unit_holds(id) on delete restrict,
  guest_id uuid references profiles(id),        -- null si reservó sin cuenta

  status   booking_status not null default 'pending',

  check_in  date not null,
  check_out date not null,
  nights    int generated always as (check_out - check_in) stored,
  guests    int not null default 1 check (guests > 0),

  -- Datos del huésped congelados al momento de reservar. Si luego edita su
  -- perfil, la reserva conserva con quién se pactó.
  guest_name     text not null,
  guest_email    text not null,
  guest_phone    text,
  guest_document text,
  notes          text,

  -- Dinero. USD es la fuente de verdad; VES es lo que se cobra.
  subtotal_usd     numeric(12, 2) not null check (subtotal_usd >= 0),
  cleaning_fee_usd numeric(12, 2) not null default 0,
  discount_usd     numeric(12, 2) not null default 0,
  total_usd        numeric(12, 2) not null check (total_usd >= 0),

  rate_snapshot numeric(18, 6) not null check (rate_snapshot > 0),
  total_ves     numeric(18, 2) not null,
  igtf_ves      numeric(18, 2) not null default 0,

  -- Anticipo exigido para confirmar, como fracción del total.
  deposit_ratio numeric(4, 3) not null default 1.000
    check (deposit_ratio > 0 and deposit_ratio <= 1),

  -- Un pending retiene inventario; sin esto, un carrito abandonado bloquea
  -- fechas vendibles indefinidamente.
  expires_at timestamptz,

  cancelled_at   timestamptz,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint bookings_date_order check (check_out > check_in)
);

create index on bookings (status);
create index on bookings (unit_id, check_in);
create index on bookings (guest_email);
create index on bookings (expires_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------------

-- Una sola tabla hace de ledger y de bandeja de verificación. Solo las filas
-- 'approved' cuentan para el saldo; la bandeja del administrador es el conjunto
-- 'verifying'.
--
-- El reporte manual (el huésped declara canal, origen, referencia, monto, fecha
-- y sube captura) es un método de primera clase, no un parche: es como se
-- confirma la mayoría de los pagos en Venezuela, y seguirá existiendo aunque
-- más adelante se integre C2P por API.

create type payment_kind   as enum ('deposit', 'balance', 'refund');
create type payment_status as enum ('pending', 'verifying', 'approved', 'rejected', 'refunded');
create type payment_method as enum (
  'pago_movil',      -- P2P reportado por el huésped
  'c2p',             -- Comercio a Persona (API bancaria, F2)
  'transferencia',   -- transferencia bancaria nacional
  'zelle',
  'binance',
  'paypal',
  'usdt',
  'tarjeta',
  'efectivo'
);

create table payments (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,

  kind   payment_kind   not null default 'deposit',
  method payment_method not null,
  status payment_status not null default 'verifying',

  -- Monto tal como se pagó, en la moneda en que se pagó.
  currency text not null check (currency in ('USD', 'VES')),
  amount   numeric(18, 2) not null check (amount > 0),

  -- Normalizado a USD para reportes, usando la tasa aplicada.
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  rate_used  numeric(18, 6),

  -- Datos del comprobante declarados por el huésped.
  origin     text,          -- email de Zelle, usuario de Binance, teléfono de Pago Móvil
  reference  text,          -- ID de transacción o número de referencia
  paid_at    timestamptz,   -- fecha en que dice haber pagado
  receipt_path text,        -- captura en Supabase Storage
  payer_name text,
  payer_document text,
  payer_bank text,

  gateway_payload jsonb,    -- respuesta cruda del banco cuando el pago es por API

  -- Verificación
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  rejection_reason text,
  admin_notes     text,

  created_at timestamptz not null default now()
);

create index on payments (booking_id);
create index on payments (status) where status = 'verifying';

-- Una misma referencia bancaria no puede respaldar dos pagos aprobados.
-- Es el fraude más común en el flujo de reporte manual.
create unique index payments_unique_approved_reference
  on payments (method, reference)
  where reference is not null and status = 'approved';

-- ---------------------------------------------------------------------------
-- Contenido y configuración
-- ---------------------------------------------------------------------------

-- Secciones editables del home, para que el operador cambie textos sin deploy.
create table site_content (
  key        text primary key,   -- 'hero', 'about', 'services', 'faq', 'contact'
  data       jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table app_settings (
  id             boolean primary key default true check (id),   -- singleton
  business_name  text not null default 'reserVE',
  business_email text,
  business_phone text,
  currency_display text not null default 'both'
    check (currency_display in ('usd', 'ves', 'both')),
  default_deposit_ratio numeric(4, 3) not null default 0.300
    check (default_deposit_ratio > 0 and default_deposit_ratio <= 1),
  pending_ttl_hours int not null default 24 check (pending_ttl_hours > 0),

  -- Solo los contribuyentes especiales designados por el SENIAT recaudan IGTF.
  igtf_enabled boolean not null default false,
  igtf_rate    numeric(4, 3) not null default 0.030,

  cancellation_policy text,
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Disponibilidad y cotización
-- ---------------------------------------------------------------------------

create function is_available(p_unit_id uuid, p_check_in date, p_check_out date)
returns boolean
language sql stable
as $$
  select not exists (
    select 1 from unit_holds
    where unit_id = p_unit_id
      and is_active
      and stay && daterange(p_check_in, p_check_out, '[)')
  );
$$;

-- Autoridad única sobre el precio. El cliente envía fechas y huéspedes, nunca un
-- total; cualquier monto que llegue desde el navegador se ignora.
create function quote_stay(p_unit_id uuid, p_check_in date, p_check_out date, p_guests int default 1)
returns jsonb
language plpgsql stable
as $$
declare
  v_unit     units%rowtype;
  v_settings app_settings%rowtype;
  v_nights   int;
  v_subtotal numeric(12, 2) := 0;
  v_min_req  int;
  v_night_min int;
  v_rate     numeric(18, 6);
  v_total    numeric(12, 2);
  v_night    date;
  v_price    numeric(10, 2);
begin
  select * into v_unit from units where id = p_unit_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unit_not_found');
  end if;

  select * into v_settings from app_settings;

  v_nights := p_check_out - p_check_in;
  if v_nights <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_dates');
  end if;

  if p_guests > v_unit.max_guests then
    return jsonb_build_object('ok', false, 'error', 'too_many_guests');
  end if;

  if p_check_in < current_date + v_unit.advance_notice_days then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  -- Precio noche a noche: la temporada manda donde exista, si no la tarifa base.
  -- El mínimo de noches exigido es el más restrictivo de todas las temporadas
  -- que toca la estadía, así que se acumula en lugar de reasignarse.
  v_min_req := v_unit.min_nights;
  for v_night in select generate_series(p_check_in, p_check_out - 1, '1 day')::date loop
    select sr.price_usd, sr.min_nights
      into v_price, v_night_min
    from season_rates sr
    where sr.unit_id = p_unit_id and sr.period @> v_night;

    v_subtotal := v_subtotal + coalesce(v_price, v_unit.base_price_usd);
    v_min_req  := greatest(v_min_req, coalesce(v_night_min, v_unit.min_nights));
  end loop;

  if v_nights < v_min_req then
    return jsonb_build_object('ok', false, 'error', 'below_min_nights', 'min_nights', v_min_req);
  end if;

  if v_unit.max_nights is not null and v_nights > v_unit.max_nights then
    return jsonb_build_object('ok', false, 'error', 'above_max_nights', 'max_nights', v_unit.max_nights);
  end if;

  if not is_available(p_unit_id, p_check_in, p_check_out) then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  v_total := v_subtotal + v_unit.cleaning_fee_usd;
  v_rate  := current_rate();

  if v_rate is null then
    return jsonb_build_object('ok', false, 'error', 'no_exchange_rate');
  end if;

  return jsonb_build_object(
    'ok',               true,
    'nights',           v_nights,
    'subtotal_usd',     v_subtotal,
    'cleaning_fee_usd', v_unit.cleaning_fee_usd,
    'total_usd',        v_total,
    'rate',             v_rate,
    'total_ves',        round(v_total * v_rate, 2),
    'deposit_ratio',    v_settings.default_deposit_ratio,
    'deposit_usd',      round(v_total * v_settings.default_deposit_ratio, 2)
  );
end;
$$;

-- Libera las fechas de los pendientes vencidos. Se invoca desde un cron.
create function expire_stale_bookings()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
begin
  with expired as (
    update bookings
       set status = 'expired', updated_at = now()
     where status = 'pending'
       and expires_at is not null
       and expires_at < now()
    returning hold_id
  )
  update unit_holds
     set is_active = false
   where id in (select hold_id from expired);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table profiles            enable row level security;
alter table properties          enable row level security;
alter table units               enable row level security;
alter table unit_media          enable row level security;
alter table amenities           enable row level security;
alter table unit_amenities      enable row level security;
alter table season_rates        enable row level security;
alter table unit_holds          enable row level security;
alter table availability_blocks enable row level security;
alter table exchange_rates      enable row level security;
alter table bookings            enable row level security;
alter table payments            enable row level security;
alter table site_content        enable row level security;
alter table app_settings        enable row level security;

-- Perfiles: cada quien el suyo; el personal ve todos.
create policy profiles_self on profiles for select using (id = auth.uid() or is_staff());
create policy profiles_update_self on profiles for update using (id = auth.uid());
create policy profiles_staff_all on profiles for all using (is_staff()) with check (is_staff());

-- Catálogo: lectura pública de lo publicado, escritura solo del personal.
create policy properties_read on properties for select using (true);
create policy properties_write on properties for all using (is_staff()) with check (is_staff());

create policy units_read on units for select using (is_published or is_staff());
create policy units_write on units for all using (is_staff()) with check (is_staff());

create policy unit_media_read on unit_media for select using (true);
create policy unit_media_write on unit_media for all using (is_staff()) with check (is_staff());

create policy amenities_read on amenities for select using (true);
create policy amenities_write on amenities for all using (is_staff()) with check (is_staff());

create policy unit_amenities_read on unit_amenities for select using (true);
create policy unit_amenities_write on unit_amenities for all using (is_staff()) with check (is_staff());

create policy season_rates_read on season_rates for select using (true);
create policy season_rates_write on season_rates for all using (is_staff()) with check (is_staff());

create policy exchange_rates_read on exchange_rates for select using (true);
create policy exchange_rates_write on exchange_rates for all using (is_staff()) with check (is_staff());

create policy site_content_read on site_content for select using (true);
create policy site_content_write on site_content for all using (is_staff()) with check (is_staff());

create policy app_settings_read on app_settings for select using (true);
create policy app_settings_write on app_settings for all using (is_staff()) with check (is_staff());

-- Ocupación: las fechas ocupadas son públicas (el calendario las muestra), pero
-- el motivo del bloqueo no lo es.
create policy unit_holds_read on unit_holds for select using (true);
create policy unit_holds_write on unit_holds for all using (is_staff()) with check (is_staff());

create policy blocks_staff on availability_blocks for all using (is_staff()) with check (is_staff());

-- Reservas: el huésped ve las suyas; el personal ve todas.
-- Las reservas se crean por función del servidor, no por insert directo del
-- cliente, porque hay que crear el hold en la misma transacción.
create policy bookings_own on bookings for select
  using (guest_id = auth.uid() or is_staff());
create policy bookings_staff on bookings for all
  using (is_staff()) with check (is_staff());

-- Pagos: el huésped puede reportar un pago sobre su reserva y ver el estado,
-- pero no puede aprobarlo ni editarlo después de enviarlo.
create policy payments_own_read on payments for select
  using (
    is_staff() or exists (
      select 1 from bookings b
      where b.id = payments.booking_id and b.guest_id = auth.uid()
    )
  );
create policy payments_own_insert on payments for insert
  with check (
    status = 'verifying' and exists (
      select 1 from bookings b
      where b.id = payments.booking_id and b.guest_id = auth.uid()
    )
  );
create policy payments_staff on payments for all
  using (is_staff()) with check (is_staff());
