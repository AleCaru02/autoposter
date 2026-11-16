import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeDataUrl, imageStorageUrl, isPublicBlobUrl, migrateDataUrlImages, sha256Hex } from "../api/_lib/image-storage.js";

const PROFILE = "11111111-1111-1111-1111-111111111111";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
assert.deepEqual(decodeDataUrl(dataUrl).bytes, png);
assert.ok(isPublicBlobUrl("https://abc123.public.blob.vercel-storage.com/images/x.png"));
assert.ok(!isPublicBlobUrl("https://evil.example.com/x.png"));

// Without a Blob token new images keep the legacy data URL (QA/local).
const legacy = await imageStorageUrl({ profileId: PROFILE, name: "a", bytes: png, mimeType: "image/png", env: {} });
assert.equal(legacy.mode, "DATABASE_DATA_URL_V1"); assert.equal(legacy.storageUrl, dataUrl);

// With a token they go to public Blob with an unguessable suffix.
const store = new Map<string, Uint8Array>();
const putFn = (async (pathname: string, body: Buffer, opts: { access: string; addRandomSuffix: boolean }) => {
  assert.equal(opts.access, "public"); assert.equal(opts.addRandomSuffix, true);
  const url = `https://abc123.public.blob.vercel-storage.com/${pathname.replace(/\.(\w+)$/, "-RND.$1")}`;
  store.set(url, new Uint8Array(body));
  return { url, pathname };
}) as never;
const blob = await imageStorageUrl({ profileId: PROFILE, name: "asset-1", bytes: png, mimeType: "image/png", env: { BLOB_READ_WRITE_TOKEN: "t" }, putFn });
assert.equal(blob.mode, "VERCEL_BLOB_PUBLIC_V1"); assert.ok(blob.storageUrl.startsWith("https://abc123.public.blob.vercel-storage.com/images/11111111-1111-1111-1111-111111111111/asset-1"));

// Migration: backup first, verified copy, guarded switch.
type Row = { id: string; profile_id: string; storage_url: string; mime_type: string };
const assets: Row[] = [{ id: "a1", profile_id: PROFILE, storage_url: dataUrl, mime_type: "image/png" }];
const backups = new Map<string, Record<string, unknown>>();
const order: string[] = [];
const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join("?");
  if (/select id::text as id from public\.assets/.test(text)) return assets.filter((a) => a.storage_url.startsWith("data:image/")).map((a) => ({ id: a.id }));
  if (/select id::text as id, profile_id::text/.test(text)) return assets.filter((a) => a.id === values[0] && a.storage_url.startsWith("data:image/"));
  if (/insert into public\.asset_storage_backups/.test(text)) { order.push("backup"); if (!backups.has(String(values[0]))) backups.set(String(values[0]), { original: values[2], sha: values[3] }); return []; }
  if (/update public\.assets/.test(text)) {
    order.push("switch");
    const row = assets.find((a) => a.id === values[2]);
    const { createHash } = await import("node:crypto");
    if (!row || createHash("md5").update(row.storage_url).digest("hex") !== values[3]) return [];
    row.storage_url = String(values[0]); return [{ id: row.id }];
  }
  if (/update public\.asset_storage_backups/.test(text)) { order.push("verified"); Object.assign(backups.get(String(values[2]))!, { blob: values[0] }); return []; }
  throw new Error("unexpected " + text.slice(0, 60));
}) as never;
const fetcher = async (url: string) => { order.push("download"); const body = store.get(url); return body ? new Response(Buffer.from(body)) : new Response("", { status: 404 }); };
const result = await migrateDataUrlImages({ DATABASE_URL: "postgres://x", BLOB_READ_WRITE_TOKEN: "t" }, { sql, putFn, fetcher });
assert.deepEqual(result, { checked: 1, migrated: 1, failed: 0, codes: [] });
assert.deepEqual(order, ["backup", "download", "switch", "verified"], "backup before upload, verify before switch");
assert.ok(isPublicBlobUrl(assets[0].storage_url));
assert.equal(backups.get("a1")!.original, dataUrl, "original kept");
assert.equal(backups.get("a1")!.sha, await sha256Hex(png));

// Corrupted copy: no switch, original untouched.
assets.push({ id: "a2", profile_id: PROFILE, storage_url: dataUrl, mime_type: "image/png" });
order.length = 0;
const corrupt = async () => new Response(Buffer.from([0, 0, 0]));
const bad = await migrateDataUrlImages({ DATABASE_URL: "postgres://x", BLOB_READ_WRITE_TOKEN: "t" }, { sql, putFn, fetcher: corrupt });
assert.equal(bad.migrated, 0); assert.deepEqual(bad.codes, ["IMAGE_MIGRATION_HASH_MISMATCH"]);
assert.equal(assets[1].storage_url, dataUrl); assert.ok(!order.includes("switch"));

// Not configured: does nothing.
assert.deepEqual((await migrateDataUrlImages({ DATABASE_URL: "postgres://x" }, { sql })).codes, ["IMAGE_MIGRATION_NOT_CONFIGURED"]);

// Wiring: writers use Blob, the Worker bundle does not import @vercel/blob, migration is opt-in.
const worker = readFileSync(new URL("../cloudflare/asset-library.ts", import.meta.url), "utf8");
assert.ok(!/from "[^"]*(@vercel\/blob|image-storage)/.test(worker), "Worker stays free of @vercel/blob");
assert.ok(/env\.uploadImage/.test(worker));
assert.ok(readFileSync(new URL("../api/assets.ts", import.meta.url), "utf8").includes("uploadImageBlob("));
assert.equal((readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8").match(/imageStorageUrl\(/g) ?? []).length, 2);
assert.ok(readFileSync(new URL("../api/generate-image.ts", import.meta.url), "utf8").includes("storage_url: (await imageStorageUrl("));
assert.ok(readFileSync(new URL("../api/cron.ts", import.meta.url), "utf8").includes('ASSET_BLOB_MIGRATION_ENABLED?.trim() === "true"'));

console.log("image-storage: PASS");
