-- La política de cancelación deja de estar partida en dos sitios.
--
-- Hasta ahora convivían tres textos que hablaban de lo mismo sin conocerse:
--
--   1. app_settings.cancellation_tiers  — la escalera que calcula el reembolso
--   2. app_settings.cancellation_policy — una nota libre en Ajustes
--   3. site_content.legal_cancelacion   — título y cuerpo en Contenido
--
-- Solo (1) mueve dinero: la lee `cancellation_quote()`. Las otras dos eran prosa
-- que se apilaba debajo en /legal/cancelacion sin que nada comprobara que dijeran
-- lo mismo. Un operador podía escribir en (3) «devolvemos todo hasta 24 h antes»
-- teniendo (1) configurado de otra forma, y la página quedaba contradiciéndose a
-- sí misma en un texto vinculante.
--
-- Se unifican en app_settings, junto a los tramos, para que quien edita la regla
-- vea al lado el texto que la acompaña. (3) desaparece de site_content.

alter table app_settings
  add column if not exists cancellation_title text;

comment on column app_settings.cancellation_title is
  'Título de /legal/cancelacion. Vacío usa «Política de cancelación».';

comment on column app_settings.cancellation_policy is
  'Texto de apoyo de la política. Acompaña a los tramos, no los sustituye: '
  'la escalera se publica siempre y es la que calcula el reembolso.';

-- Traer lo que hubiera en Contenido. El cuerpo se anexa a la nota existente en
-- lugar de pisarla: los dos campos eran libres y cualquiera de los dos puede
-- tener el texto bueno.
do $$
declare
  v_data jsonb;
begin
  select data into v_data from site_content where key = 'legal_cancelacion';

  if v_data is not null then
    update app_settings
       set cancellation_title = coalesce(
             nullif(btrim(v_data->>'title'), ''),
             cancellation_title
           ),
           cancellation_policy = nullif(
             concat_ws(
               E'\n\n',
               nullif(btrim(cancellation_policy), ''),
               nullif(btrim(v_data->>'body'), '')
             ),
             ''
           )
     where id;

    delete from site_content where key = 'legal_cancelacion';
  end if;
end $$;
