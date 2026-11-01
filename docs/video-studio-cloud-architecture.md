# Video Studio — cloud implementation and release gates

## Architecture
- Existing Cloudflare Worker: authenticates the user and checks profile ownership.
- Neon: `video_studio_jobs` tracks state and idempotency; `video_studio_budget` holds atomic monthly reservations. Migration: `migrations/20261101_video_studio_jobs.sql`.
- R2 (not provisioned): private original PNG files, temporary render inputs, and final MP4 objects. Store only object keys in Neon, not public URLs.
- Cloudflare Containers (not provisioned): an authenticated rendering worker with FFmpeg/ffprobe. Never accept an arbitrary command or arbitrary URL from a client.
- Browser: submit job, poll status, show progress/errors and authenticated preview only when READY.
- OpenAI image and optional voice providers: only from server, never from browser. Budget reservation before paid calls.

## Job state transitions
QUEUED -> GENERATING -> RENDERING -> READY. Failure -> FAILED. Cancellation -> CANCELLED. State changes must be atomic and scoped to the authenticated owner. Workers must be idempotent and lease jobs to avoid duplicate provider charges.

## Blocking release gates
1. Deploy and validate SQL migration in staging with two concurrent reservation attempts, same-key retries, budget exhaustion and cross-tenant tests.
2. Implement server-only image generation with cost estimate and *actual* settlement; refund unused reservation on FAILED/CANCELLED. No paid requests before both paths are tested.
3. Provision private R2 bucket and enforce object ownership, content type, size and retention.
4. Deploy container image with FFmpeg, health check, bounded runtime, verified MP4 dimensions/duration and signed job dispatch.
5. Wire start/status/preview endpoints to authenticated frontend; show a real playable MP4.
6. Run offline end-to-end and staging end-to-end tests. Production publication remains manually approved.

## Known constraints
- Existing Video Studio preflight deliberately returns 503 while rendering/storage/budget are unconfigured.
- `scripts/render-video-assets.py` renders local PNGs but is not a cloud service.
- Existing avatar scenes are represented by static images; this is not a talking avatar.
- 30 EUR is a cap, not a guarantee that all cloud/provider usage fits under it. Cloudflare and third-party costs must be monitored separately.
- Do not claim this feature is live until a staging job reaches READY and a browser preview plays the generated video.
