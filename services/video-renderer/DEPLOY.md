# Video renderer — deployment checklist (NOT deployed)

The repository contains an independently deployable Docker polling worker. It is not yet wired to a Cloudflare Container binding or deployed to an always-on host. Cloudflare Containers have their own lifecycle; this infinite polling process needs a compatible long-running runtime or an HTTP-triggered Container adapter.

## Required configuration

1. Apply `migrations/20261101_video_studio_jobs.sql` to a staging Neon branch; test reservations, retries, isolation, refunds and concurrent jobs before production.
2. Provision a private Cloudflare R2 bucket and configure the application Worker binding `VIDEO_MEDIA`. Example Wrangler stanza (add to environment-specific config, not the existing production config):

```json
"r2_buckets": [{ "binding": "VIDEO_MEDIA", "bucket_name": "autoposter-video-private" }]
```

3. Provide the Docker renderer with server-side secrets only: `DATABASE_URL`, `VIDEO_R2_BUCKET`, `VIDEO_R2_ENDPOINT` (https://<account-id>.r2.cloudflarestorage.com), `VIDEO_R2_ACCESS_KEY_ID`, `VIDEO_R2_SECRET_ACCESS_KEY`. Use a restricted bucket token and dedicated DB role with least privilege; do not put secrets in Wrangler vars or frontend.
4. Deploy `services/video-renderer/Dockerfile` to a compatible long-running container platform with a single initial replica. Never deploy this polling image as a request-based Cloudflare Container without a lifecycle adapter.
5. Only after the renderer is healthy, R2 is connected and the budget migration is verified, set `VIDEO_RENDER_ENABLED=true` as a Worker environment variable. Until then the enqueue endpoint returns 503.
6. Submit a storyboard and upload a PNG for each scene. Renderer waits for all PNGs before claiming the job. On success the authenticated status endpoint exposes a private MP4 preview.

## Limitations / production blockers

- **No automatic AI image creation in the cloud job.** The current image generator is a separate experimental module. Its model identifier and billing need verification against the live provider API.
- **No voice/audio or talking avatar.** Output is a silent MP4 from user-uploaded PNGs.
- **Cost accounting is incomplete.** Current renderer releases the entire reserved estimate and records zero *metered API* cost; it does not measure Cloudflare/R2/Neon infrastructure charges. Do not represent the 30 EUR budget as a complete cloud cost ceiling.
- **No lease expiry / recovery** for a process crash after state becomes RENDERING. Add durable leases and retries before production.
- **No full end-to-end staging test** has been performed.
- Manual approval and Instagram publishing of these new MP4 jobs are not wired together.
- Video preview currently downloads the full MP4 into a browser Blob, rather than supporting Range streaming.

These blockers mean `VIDEO_RENDER_ENABLED` should remain unset in production until a proper staging sign-off.
