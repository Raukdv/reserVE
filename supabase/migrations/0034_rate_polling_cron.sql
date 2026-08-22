-- Sondeo frecuente de la tasa BCV desde la base.
--
-- ## Por qué no basta el cron de Vercel
--
-- Desde la `0033` rige la última tasa publicada, no la de fecha valor cumplida.
-- El BCV abre sobre las 7:00 y cierra entre las 18:00 y las 20:00 VET, y desde
-- el instante en que publica, lo anterior deja de ser legal. El hueco entre esa
-- publicación y nuestra lectura es tiempo cobrando mal.
--
-- El plan Hobby de Vercel solo admite frecuencia diaria. Una sola lectura al día
-- deja un hueco de hasta 24 horas.
--
-- ## Por qué desde Postgres y no una Edge Function
--
-- Supabase no tiene planificador propio: sus «scheduled edge functions» son
-- `cron.schedule` + `net.http_post`, exactamente esto con una capa encima. Y una
-- Edge Function tendría que reimplementar en Deno lo que ya está en `bcv.ts`
-- —divergencia entre fuentes, salto diario anómalo, el TLS relajado solo para
-- `bcv.org.ve`—. Dos implementaciones de la misma norma legal es una de más.
--
-- Así que la base llama al endpoint que ya existe. La lógica sigue en un sitio.
--
-- ## El secreto
--
-- `pg_net` tiene que mandar el `CRON_SECRET` en la cabecera, así que el secreto
-- entra en la base. Va en Vault, cifrado, no en el texto del `cron.job`: la
-- tabla `cron.job` la lee cualquiera con acceso a la base, y dejar ahí el
-- secreto en claro convertiría el endpoint en público para quien mirase.
--
-- Los valores no están en esta migración —no se versionan secretos—. Los siembra
-- `scripts/setup-rate-cron.mjs` desde `.env.local`.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- El disparo
-- ---------------------------------------------------------------------------

-- `security definer` porque `vault.decrypted_secrets` no es legible por los
-- roles de la aplicación, y no debe serlo: la gracia de Vault es justamente que
-- el secreto no esté al alcance de una consulta cualquiera.
create or replace function cron_ping_rate()
returns bigint
language plpgsql
security definer set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'site_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'cron_secret';

  if v_url is null or v_secret is null then
    raise exception 'faltan los secretos site_url o cron_secret en Vault';
  end if;

  -- `only=rate` hace solo la tasa. Los recordatorios de llegada y la poda de
  -- bitácoras son trabajo de una vez al día y los sigue haciendo el cron de
  -- Vercel; arrastrarlos treinta veces sería gasto sin motivo.
  --
  -- La llamada es asíncrona: devuelve un identificador y la respuesta aterriza
  -- luego en `net._http_response`. No se espera a propósito. Si el endpoint no
  -- responde, quien lo delata es `rate_is_stale()`, que ya existe y ya corta la
  -- cotización — no hace falta una segunda vigilancia peor.
  return net.http_get(
    url     := rtrim(v_url, '/') || '/api/cron/daily?only=rate',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 20000
  );
end;
$$;

comment on function cron_ping_rate() is
  'Pide al endpoint una relectura de la tasa BCV. La llama pg_cron; nadie más '
  'debe poder invocarla, porque usa el CRON_SECRET guardado en Vault.';

revoke all on function cron_ping_rate from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- El horario
-- ---------------------------------------------------------------------------

-- pg_cron programa en UTC y Venezuela va cuatro horas por detrás, así que la
-- franja de 07:00 a 21:00 VET son las horas 11–23 y 0–1 de UTC. Cubre el día
-- entero de operación del BCV: publican de mañana, de tarde o de noche, y la
-- que salga rige desde ese momento.
--
-- Cada media hora: 30 sondeos al día, 900 al mes contra el millón de
-- invocaciones del plan Hobby. Y `fetchAndStoreRate` no escribe si el valor no
-- cambió, así que 29 de esos 30 no tocan la base.
select cron.unschedule('fetch-bcv-rate')
where exists (select 1 from cron.job where jobname = 'fetch-bcv-rate');

select cron.schedule('fetch-bcv-rate', '*/30 0-1,11-23 * * *', 'select cron_ping_rate()');
