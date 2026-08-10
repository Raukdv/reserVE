-- Expiración de reservas pendientes, cada 15 minutos.
--
-- Va en pg_cron y no en un cron de Vercel porque el plan Hobby solo admite
-- frecuencia diaria, y una reserva abandonada bloqueando fechas durante 24 horas
-- es inventario perdido. Además corre dentro de la base: no gasta invocaciones
-- de función ni depende de la plataforma de despliegue.
--
-- Ver docs/COSTO-CERO.md, regla 3.1.

create extension if not exists pg_cron;

-- Reprogramar es idempotente: si el trabajo ya existía, se elimina primero.
do $$
begin
  perform cron.unschedule('expire-stale-bookings');
exception when others then
  null;  -- no existía todavía
end;
$$;

select cron.schedule(
  'expire-stale-bookings',
  '*/15 * * * *',
  $$ select expire_stale_bookings() $$
);
