-- Cuentas de cobro del negocio.
--
-- El flujo de pago venezolano es "te digo a dónde pagar, pagas, me reportas el
-- comprobante". Sin estos datos el huésped no puede completar el primer paso, así
-- que son parte del producto y no configuración accesoria.
--
-- Se administran desde el panel para que el operador cambie de banco o de correo
-- Zelle sin tocar código.

create table payment_accounts (
  id     uuid primary key default gen_random_uuid(),
  method payment_method not null,

  -- Cómo se muestra en el selector: "Pago Móvil Banesco", "Zelle personal".
  label  text not null,

  holder     text,   -- titular de la cuenta
  document   text,   -- cédula o RIF del titular
  bank       text,   -- banco, cuando aplica

  -- El dato al que se paga: teléfono, correo, usuario, wallet o número de cuenta.
  identifier text not null,

  -- Aclaraciones libres: red de la wallet, horario, tipo de cuenta.
  instructions text,

  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index on payment_accounts (is_active, sort_order);

alter table payment_accounts enable row level security;

-- Lectura pública de las activas: el huésped las necesita antes de pagar, y sin
-- sesión. Son datos de cobro que el negocio publica igual en su web.
create policy payment_accounts_read on payment_accounts
  for select using (is_active or is_staff());

create policy payment_accounts_write on payment_accounts
  for all using (is_staff()) with check (is_staff());
