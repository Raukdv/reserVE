-- Bitácora de correo transaccional.
--
-- El plan Hobby de Vercel retiene una hora de logs de ejecución, así que un
-- envío fallido desaparece antes de que nadie lo note. Como el correo es lo
-- único que devuelve al huésped a su reserva —el código solo vive en la URL—,
-- un fallo silencioso significa un huésped que no puede pagar y no sabe por qué.
--
-- Ver docs/COSTO-CERO.md, regla 3.9.

create type email_kind as enum (
  'booking_created',
  'payment_received',
  'payment_approved',
  'payment_rejected',
  'arrival_reminder'
);

create table email_log (
  id         bigserial primary key,
  sent_at    timestamptz not null default now(),
  kind       email_kind not null,
  recipient  text not null,
  booking_id uuid references bookings(id) on delete set null,
  ok         boolean not null,
  provider_id text,   -- identificador de Resend, para rastrear en su panel
  detail     text
);

create index on email_log (sent_at desc);
create index on email_log (booking_id);

-- Un recordatorio de llegada debe salir una sola vez por reserva, aunque el cron
-- corra dos veces el mismo día por un reintento.
create unique index email_log_one_reminder
  on email_log (booking_id, kind)
  where kind = 'arrival_reminder' and ok;

alter table email_log enable row level security;

create policy email_log_staff on email_log for select using (is_staff());

-- Conserva 90 días, igual que rate_fetch_log.
create or replace function prune_email_log()
returns void
language sql
security definer set search_path = public
as $$
  delete from email_log where sent_at < now() - interval '90 days';
$$;

-- ---------------------------------------------------------------------------
-- Reservas que llegan mañana
-- ---------------------------------------------------------------------------

-- Alimenta el recordatorio diario. Excluye las que ya lo recibieron, así que es
-- seguro llamarla varias veces.
create or replace function bookings_arriving_tomorrow()
returns table (
  id uuid,
  code text,
  guest_name text,
  guest_email text,
  unit_name text,
  check_in date,
  check_out date,
  nights int,
  total_usd numeric,
  paid_usd numeric
)
language sql
stable
security definer set search_path = public
as $$
  select
    b.id, b.code, b.guest_name, b.guest_email, u.name, b.check_in, b.check_out,
    b.nights, b.total_usd,
    coalesce((
      select sum(p.amount_usd) from payments p
      where p.booking_id = b.id and p.status = 'approved'
    ), 0)
  from bookings b
  join units u on u.id = b.unit_id
  where b.check_in = business_today() + 1
    and b.status = 'confirmed'
    and not exists (
      select 1 from email_log e
      where e.booking_id = b.id and e.kind = 'arrival_reminder' and e.ok
    );
$$;
