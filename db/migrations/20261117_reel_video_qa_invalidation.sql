-- A Reel's QA and approval must become invalid whenever its MP4 changes.
-- Cover images were already tracked; the video_asset_id was previously omitted.
create or replace function public.invalidate_variant_qa_on_change()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if row(NEW.hook,NEW.caption,NEW.cta,NEW.hashtags,NEW.visual_brief,NEW.alt_text,
         NEW.image_asset_id,NEW.video_asset_id,NEW.eligible,NEW.provider,NEW.format)
     is distinct from
     row(OLD.hook,OLD.caption,OLD.cta,OLD.hashtags,OLD.visual_brief,OLD.alt_text,
         OLD.image_asset_id,OLD.video_asset_id,OLD.eligible,OLD.provider,OLD.format) then
    NEW.qa_status := 'PENDING';
    NEW.qa_fingerprint := null;
    NEW.qa_result := '{}'::jsonb;
    NEW.qa_checked_at := null;
    NEW.approved_fingerprint := null;
    NEW.approved_by := null;
    NEW.approved_at := null;
    NEW.rejected_reason := null;
    if OLD.workflow_status='APPROVED' or OLD.approval_status='APPROVED' then
      NEW.workflow_status := 'REVIEW_REQUIRED';
    elsif NEW.workflow_status <> 'DRAFT' then
      NEW.workflow_status := 'REVIEW';
    end if;
    if OLD.approval_status='APPROVED' then
      NEW.approval_status := 'PENDING';
    end if;
  end if;
  return NEW;
end;
$$;
-- Existing content_variants_qa_invalidation trigger remains attached.
