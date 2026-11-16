import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

/**
 * Social images live in the public Vercel Blob store (unguessable random suffix), not in
 * Postgres. Multi-MB data URLs in public.assets were re-read by the app and drained the Neon
 * free-plan transfer quota (4.77 / 5 GB on 16/11/2026). Identity material never uses this:
 * it stays in the private identity store.
 */
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const BLOB_HOST = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//;

export function imageBlobConfigured(env: { BLOB_READ_WRITE_TOKEN?: string } = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function isPublicBlobUrl(value: string | null | undefined) {
  return typeof value === "string" && BLOB_HOST.test(value);
}

export function decodeDataUrl(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) throw new Error("ASSET_DATA_URL_INVALID");
  return { mimeType: match[1], bytes: new Uint8Array(Buffer.from(match[2], "base64")) };
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type PutFn = typeof put;

export async function uploadImageBlob(input: { profileId: string; name: string; bytes: Uint8Array; mimeType: string; token: string; putFn?: PutFn }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.profileId)) throw new Error("IMAGE_STORAGE_PROFILE_INVALID");
  const extension = EXTENSIONS[input.mimeType];
  if (!extension) throw new Error("IMAGE_STORAGE_MIME_INVALID");
  const safeName = input.name.replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "image";
  const blob = await (input.putFn ?? put)(`images/${input.profileId}/${safeName}.${extension}`, Buffer.from(input.bytes), {
    access: "public",
    addRandomSuffix: true,
    contentType: input.mimeType,
    token: input.token,
  });
  return { url: blob.url, pathname: blob.pathname };
}

/**
 * Value to store in assets.storage_url for a new image: a public Blob URL when the store is
 * configured, otherwise the legacy data URL (QA/local without Blob keep working).
 */
export async function imageStorageUrl(input: { profileId: string; name: string; bytes: Uint8Array; mimeType: string; env?: { BLOB_READ_WRITE_TOKEN?: string }; putFn?: PutFn }) {
  const token = (input.env ?? process.env).BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return { storageUrl: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`, mode: "DATABASE_DATA_URL_V1" as const };
  const blob = await uploadImageBlob({ ...input, token });
  return { storageUrl: blob.url, mode: "VERCEL_BLOB_PUBLIC_V1" as const, pathname: blob.pathname };
}

type Sql = ReturnType<typeof neon>;
type Fetcher = (url: string) => Promise<Response>;

/**
 * Moves existing data-URL images to Blob, one asset at a time:
 * 1. back up the original value (asset_storage_backups, server-only), 2. upload,
 * 3. download the Blob copy and compare SHA-256 with the original bytes,
 * 4. switch storage_url only if the row still holds the same original value.
 * Nothing is deleted: the backup stays until the owner approves its removal.
 */
export async function migrateDataUrlImages(env: { DATABASE_URL?: string; BLOB_READ_WRITE_TOKEN?: string }, options: { limit?: number; sql?: Sql; putFn?: PutFn; fetcher?: Fetcher } = {}) {
  const result = { checked: 0, migrated: 0, failed: 0, codes: [] as string[] };
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!env.DATABASE_URL || !token) return { ...result, codes: ["IMAGE_MIGRATION_NOT_CONFIGURED"] };
  const sql = options.sql ?? neon(env.DATABASE_URL);
  const fetcher = options.fetcher ?? ((url: string) => fetch(url, { signal: AbortSignal.timeout(30_000) }));
  // Ids first (no payload), then one row at a time: never pull every image in one result.
  const due = await sql`
    select id::text as id from public.assets
    where kind='IMAGE' and storage_url like 'data:image/%'
    order by created_at asc limit ${Math.min(Math.max(options.limit ?? 5, 1), 20)}
  ` as unknown as Array<{ id: string }>;
  for (const { id } of due) {
    result.checked += 1;
    try {
      const rows = await sql`select id::text as id, profile_id::text as profile_id, storage_url, mime_type from public.assets where id=${id}::uuid and storage_url like 'data:image/%' limit 1` as unknown as Array<{ id: string; profile_id: string; storage_url: string; mime_type: string | null }>;
      const asset = rows[0];
      if (!asset) continue;
      const original = decodeDataUrl(asset.storage_url);
      const originalSha = await sha256Hex(original.bytes);
      await sql`
        insert into public.asset_storage_backups (asset_id, profile_id, original_storage_url, original_sha256)
        values (${asset.id}::uuid, ${asset.profile_id}::uuid, ${asset.storage_url}, ${originalSha})
        on conflict (asset_id) do nothing
      `;
      const blob = await uploadImageBlob({ profileId: asset.profile_id, name: asset.id, bytes: original.bytes, mimeType: original.mimeType, token, putFn: options.putFn });
      const check = await fetcher(blob.url);
      if (!check.ok) throw new Error(`IMAGE_MIGRATION_VERIFY_HTTP_${check.status}`);
      const copySha = await sha256Hex(new Uint8Array(await check.arrayBuffer()));
      if (copySha !== originalSha) throw new Error("IMAGE_MIGRATION_HASH_MISMATCH");
      const updated = await sql`
        update public.assets
        set storage_url=${blob.url},
            metadata=coalesce(metadata,'{}'::jsonb) || ${JSON.stringify({ storage_mode: "VERCEL_BLOB_PUBLIC_V1", blob_pathname: blob.pathname, migrated_from: "DATABASE_DATA_URL_V1", migrated_sha256: originalSha })}::jsonb,
            updated_at=now()
        where id=${asset.id}::uuid and md5(storage_url)=${createHash("md5").update(asset.storage_url).digest("hex")}
        returning id
      ` as unknown as Array<{ id: string }>;
      if (!updated.length) throw new Error("IMAGE_MIGRATION_ROW_CHANGED");
      await sql`update public.asset_storage_backups set blob_url=${blob.url}, blob_pathname=${blob.pathname}, verified_at=now() where asset_id=${asset.id}::uuid`;
      result.migrated += 1;
    } catch (reason) {
      result.failed += 1;
      const code = reason instanceof Error ? reason.message.split(":")[0] : "IMAGE_MIGRATION_FAILED";
      if (!result.codes.includes(code)) result.codes.push(code);
    }
  }
  return result;
}
