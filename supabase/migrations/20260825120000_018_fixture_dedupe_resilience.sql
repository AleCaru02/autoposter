-- Post Automatici: keep production anti-duplicate fail-closed while making deterministic E2E fixtures resilient.
-- Production content is never rewritten here. Only rows explicitly marked generation_metadata.mock=true
-- may receive a deterministic editorial suffix when a fixture generates the same copy twice.

create or replace function public.set_post_variant_content_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized text;
  v_fingerprint text;
  v_candidate_caption text;
  v_candidate_normalized text;
  v_candidate_fingerprint text;
  v_topic text;
  v_variant_no integer := 2;
begin
  if new.platform_decision = 'skip' then
    new.content_fingerprint := null;
    return new;
  end if;

  v_normalized := public.normalize_social_content_for_dedupe(
    concat_ws(E'\n', new.hook, new.caption, new.cta, array_to_string(coalesce(new.hashtags,'{}'::text[]), ' '))
  );

  if v_normalized = '' then
    new.content_fingerprint := null;
    return new;
  end if;

  v_fingerprint := md5(v_normalized);

  -- Real/production content remains strictly fail-closed: the unique index will reject
  -- an exact duplicate. Only deterministic fixture rows are differentiated so CI can
  -- exercise the rest of the pipeline without weakening production guarantees.
  if coalesce(new.generation_metadata->>'mock','false') = 'true'
     and exists (
       select 1
       from public.post_variants existing
       where existing.tenant_id = new.tenant_id
         and existing.platform = new.platform
         and existing.content_fingerprint = v_fingerprint
         and existing.id is distinct from new.id
     ) then

    select p.topic into v_topic
    from public.posts p
    where p.id = new.post_id and p.tenant_id = new.tenant_id;

    loop
      v_candidate_caption := trim(concat_ws(' ', new.caption, format('Approfondimento %s: %s.', v_variant_no, coalesce(nullif(v_topic,''),'nuovo angolo editoriale'))));
      v_candidate_normalized := public.normalize_social_content_for_dedupe(
        concat_ws(E'\n', new.hook, v_candidate_caption, new.cta, array_to_string(coalesce(new.hashtags,'{}'::text[]), ' '))
      );
      v_candidate_fingerprint := md5(v_candidate_normalized);

      exit when not exists (
        select 1
        from public.post_variants existing
        where existing.tenant_id = new.tenant_id
          and existing.platform = new.platform
          and existing.content_fingerprint = v_candidate_fingerprint
          and existing.id is distinct from new.id
      );

      v_variant_no := v_variant_no + 1;
      if v_variant_no > 50 then
        raise exception 'FIXTURE_DEDUPE_EXHAUSTED' using errcode = '23505';
      end if;
    end loop;

    new.caption := v_candidate_caption;
    new.content_fingerprint := v_candidate_fingerprint;
    return new;
  end if;

  new.content_fingerprint := v_fingerprint;
  return new;
end;
$$;

revoke all on function public.set_post_variant_content_fingerprint() from public, anon, authenticated;
grant execute on function public.set_post_variant_content_fingerprint() to service_role;
