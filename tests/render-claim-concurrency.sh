#!/usr/bin/env bash
# Real Postgres proof that a Reel render job can never run twice:
#  - 24 concurrent claims (specific + due) on one QUEUED job -> exactly one winner;
#  - a live lease is never re-claimed; an expired one is, with a new claim_token;
#  - the old runner's token can no longer write;
#  - at most one active job per source (real and dry runs counted separately).
# Runs in CI after scripts/ci-fresh-db.sh (all migrations applied). No provider call.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
q() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -tAq -c "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

PROFILE=7d0c0c10-0000-4000-8000-000000000001
CONTENT=7d0c0c10-0000-4000-8000-000000000002
SOURCE=7d0c0c10-0000-4000-8000-000000000003
JOB=7d0c0c10-0000-4000-8000-000000000004

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO neon_auth."user"(id,email,name,role,banned)
VALUES ('render-claim-user','render-claim@example.test','Render claim CI','user',false) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles(id,owner_auth_user_id,name,slug,timezone,onboarding_completed)
VALUES ('${PROFILE}','render-claim-user','Render claim CI','render-claim-ci','Europe/Rome',true);
INSERT INTO public.content_items(id,profile_id,topic,status,data_origin)
VALUES ('${CONTENT}','${PROFILE}','Render claim','IN_REVIEW','DEMO_SAMPLE');
INSERT INTO public.content_variants(id,content_id,profile_id,provider,format,eligible,caption,approval_status,data_origin,qa_status,approval_mode,workflow_status)
VALUES ('${SOURCE}','${CONTENT}','${PROFILE}','FACEBOOK','POST',true,'Fonte per il test di concorrenza dei Reel in CI.','PENDING','DEMO_SAMPLE','PASS','MANUAL','REVIEW');
INSERT INTO public.render_jobs(id,profile_id,source_variant_id,kind,idempotency_key,input)
VALUES ('${JOB}','${PROFILE}','${SOURCE}','REEL_FACELESS','reel:v1:ci-claim:1','{"dryRun":false}'::jsonb);
SQL

# 1) 24 concurrent claims: 12 targeted, 12 "due" sweeps (cron-like).
tmp=$(mktemp -d)
for i in $(seq 1 12); do
  psql "${DATABASE_URL}" -tAq -c "select count(*) from public.claim_render_job('${JOB}'::uuid, 840)" > "${tmp}/t${i}" &
  psql "${DATABASE_URL}" -tAq -c "select count(*) from public.claim_due_render_jobs(1, 840)" > "${tmp}/d${i}" &
done
wait
winners=$(cat "${tmp}"/* | awk '{s+=$1} END {print s}')
rm -rf "${tmp}"
[ "${winners}" = "1" ] || fail "expected exactly 1 concurrent claim winner, got ${winners}"
[ "$(q "select state||':'||attempt_count from public.render_jobs where id='${JOB}'")" = "RUNNING:1" ] || fail "job not RUNNING with attempt 1"
echo "PASS concurrent claims: 1 winner out of 24"

# 2) A live lease (840 s, longer than the 800 s function limit) is never re-claimed.
[ "$(q "select count(*) from public.claim_due_render_jobs(1, 840)")" = "0" ] || fail "live lease re-claimed"
[ "$(q "select count(*) from public.claim_render_job('${JOB}'::uuid, 840)")" = "0" ] || fail "running job re-claimed by id"
echo "PASS live lease not re-claimable"

# 3) Expired lease: resumed once with a new token; the old token can no longer write.
OLD=$(q "select claim_token from public.render_jobs where id='${JOB}'")
q "update public.render_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${JOB}'" >/dev/null
[ "$(q "select count(*) from public.claim_due_render_jobs(1, 840)")" = "1" ] || fail "expired lease not resumed"
NEW=$(q "select claim_token from public.render_jobs where id='${JOB}'")
[ "${OLD}" != "${NEW}" ] || fail "claim_token not rotated"
[ "$(q "with u as (update public.render_jobs set steps_completed=4 where id='${JOB}' and claim_token='${OLD}' and state='RUNNING' returning 1) select count(*) from u")" = "0" ] || fail "stale runner could still write"
[ "$(q "select attempt_count from public.render_jobs where id='${JOB}'")" = "2" ] || fail "attempt not counted on resume"
echo "PASS expired lease resumed once, stale token rejected"

# 4) One active job per source.
if q "insert into public.render_jobs(profile_id,source_variant_id,kind,idempotency_key,input) values ('${PROFILE}','${SOURCE}','REEL_FACELESS','reel:v1:ci-claim:2','{\"dryRun\":false}'::jsonb)" >/dev/null 2>&1; then
  fail "second active real job for the same source was accepted"
fi
q "insert into public.render_jobs(profile_id,source_variant_id,kind,idempotency_key,input) values ('${PROFILE}','${SOURCE}','REEL_FACELESS','reel-dry:v1:ci-claim:3','{\"dryRun\":true}'::jsonb)" >/dev/null || fail "dry run blocked by a real run"
q "update public.render_jobs set state='FAILED', claim_token=null, lease_expires_at=null where id='${JOB}'" >/dev/null
q "insert into public.render_jobs(profile_id,source_variant_id,kind,idempotency_key,input) values ('${PROFILE}','${SOURCE}','REEL_FACELESS','reel:v1:ci-claim:4','{\"dryRun\":false}'::jsonb)" >/dev/null || fail "new job refused after the previous one finished"
echo "PASS one active job per source"

psql "${DATABASE_URL}" -q -c "delete from public.profiles where id='${PROFILE}'; delete from neon_auth.\"user\" where id='render-claim-user';" >/dev/null
echo "render-claim-concurrency: ALL PASS"
