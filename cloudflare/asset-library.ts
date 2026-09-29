import { neon } from "@neondatabase/serverless";
import { imageDimensions, sha256Hex } from "../api/_lib/personal-brand-reference.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

type AssetRow = {
  id: string;
  profile_id: string;
  content_id: string | null;
  source: string;
  kind: string;
  name: string;
  storage_url: string;
  mime_type: string | null;
  tags: unknown;
  metadata: unknown;
  provider: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD" | null;
  model: string | null;
  cost_eur: number | string;
  width: number | null;
  height: number | null;
  format: string | null;
  quality_status: "PENDING" | "PASS" | "BLOCK" | "FAILED";
  identity_status: "NOT_REQUIRED" | "PENDING" | "PASS" | "BLOCK";
  publication_usage: number;
  reuse_count: number;
  last_used_at: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function uuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
}

function aspectRatio(width: number, height: number) {
  const ratio = width / height;
  const candidates: Array<[string, number]> = [
    ["1:1",1],["4:5",4/5],["5:4",5/4],["3:4",3/4],["4:3",4/3],
    ["2:3",2/3],["3:2",3/2],["9:16",9/16],["16:9",16/9],
  ];
  candidates.sort((a,b) => Math.abs(a[1]-ratio)-Math.abs(b[1]-ratio));
  return candidates[0]?.[0] ?? "1:1";
}

function text(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase() : "";
}

async function authContext(request: Request, env: Env): Promise<{ error: Response } | { sql: ReturnType<typeof neon>; authUserId: string }> {
  if (!env.DATABASE_URL) return { error: json({ error: "DATABASE_NOT_CONFIGURED" }, 503) } as const;
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  return { sql: neon(env.DATABASE_URL), authUserId } as const;
}

async function ownsProfile(sql: ReturnType<typeof neon>, profileId: string, authUserId: string) {
  const rows = await sql`
    select id::text
    from public.profiles
    where id=${profileId}::uuid
      and owner_auth_user_id=${authUserId}
      and archived_at is null
    limit 1
  ` as unknown as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function handleAssetLibrary(request: Request, env: Env): Promise<Response> {
  const ctx = await authContext(request, env);
  if ("error" in ctx) return ctx.error;
  const { sql, authUserId } = ctx;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const profileId = url.searchParams.get("profileId") || "";
    if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
    if (!await ownsProfile(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    const rows = await sql`
      select id::text,profile_id::text,content_id::text,source,kind,name,storage_url,mime_type,tags,metadata,
             provider,model,cost_eur::float8,width,height,format,quality_status,identity_status,
             publication_usage,reuse_count,last_used_at::text,content_hash,created_at::text,updated_at::text
      from public.assets
      where profile_id=${profileId}::uuid
      order by created_at desc
      limit 250
    ` as unknown as AssetRow[];

    const q = text(url.searchParams.get("q"));
    const source = text(url.searchParams.get("source"));
    const provider = text(url.searchParams.get("provider"));
    const quality = text(url.searchParams.get("quality"));
    const identity = text(url.searchParams.get("identity"));
    const contentId = url.searchParams.get("contentId") || "";

    const assets = rows.filter((row) => {
      if (source && text(row.source) !== source) return false;
      if (provider && text(row.provider) !== provider) return false;
      if (quality && text(row.quality_status) !== quality) return false;
      if (identity && text(row.identity_status) !== identity) return false;
      if (contentId && row.content_id !== contentId) return false;
      if (!q) return true;
      const haystack = [
        row.name,row.source,row.provider,row.model,row.format,
        JSON.stringify(row.tags ?? []),JSON.stringify(row.metadata ?? {}),
      ].map(text).join(" ");
      return haystack.includes(q);
    });

    const variants = await sql`
      select cv.id::text,cv.content_id::text,cv.provider,cv.format,ci.topic,cv.image_asset_id::text
      from public.content_variants cv
      join public.content_items ci on ci.id=cv.content_id and ci.profile_id=cv.profile_id
      where cv.profile_id=${profileId}::uuid
        and cv.eligible is true
        and cv.approval_status <> 'APPROVED'
      order by cv.updated_at desc
      limit 60
    ` as unknown as Array<{ id:string; content_id:string; provider:string; format:string; topic:string; image_asset_id:string|null }>;

    return json({ profileId, assets, variants });
  }

  if (request.method === "POST" && request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "INVALID_MULTIPART_BODY" }, 400);
    const profileId = String(form.get("profileId") || "");
    if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
    if (!await ownsProfile(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    const files = form.getAll("images").filter((item): item is File => item instanceof File);
    if (!files.length) return json({ error: "ASSET_IMAGES_REQUIRED" }, 400);
    if (files.length > 10) return json({ error: "ASSET_BATCH_LIMIT", maximum: 10 }, 400);

    const saved: Array<{ id:string; duplicate:boolean; name:string }> = [];
    for (const file of files) {
      if (file.size <= 0 || file.size > 4 * 1024 * 1024) return json({ error: "ASSET_FILE_SIZE_INVALID", filename:file.name }, 400);
      if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return json({ error: "ASSET_MIME_INVALID", filename:file.name }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dims = imageDimensions(bytes,file.type);
      if (!dims.width || !dims.height || Math.min(dims.width,dims.height) < 256 || Math.max(dims.width,dims.height) > 12000) {
        return json({ error: "ASSET_DIMENSIONS_INVALID", filename:file.name }, 400);
      }
      const hash = await sha256Hex(bytes);
      const existing = await sql`
        select id::text,name
        from public.assets
        where profile_id=${profileId}::uuid and content_hash=${hash}
        limit 1
      ` as unknown as Array<{id:string;name:string}>;
      if (existing[0]) {
        saved.push({ id:existing[0].id, duplicate:true, name:existing[0].name });
        continue;
      }
      const ratio = aspectRatio(dims.width,dims.height);
      const storageUrl = `data:${file.type};base64,${bytesToBase64(bytes)}`;
      const inserted = await sql`
        insert into public.assets(
          profile_id,source,kind,name,storage_url,mime_type,tags,metadata,provider,model,cost_eur,
          width,height,format,quality_status,identity_status,content_hash,updated_at
        ) values (
          ${profileId}::uuid,'USER_UPLOAD','IMAGE',${file.name.slice(0,240)},${storageUrl},${file.type},
          '["REAL_ASSET","USER_UPLOAD"]'::jsonb,
          ${JSON.stringify({aspect_ratio:ratio,storage_mode:"DATABASE_DATA_URL_V1",technical_validation:"PASS"})}::jsonb,
          'REAL_ASSET',null,0,${dims.width},${dims.height},${ratio},'PASS','NOT_REQUIRED',${hash},now()
        )
        returning id::text
      ` as unknown as Array<{id:string}>;
      if (!inserted[0]) return json({ error: "ASSET_SAVE_FAILED" }, 500);
      saved.push({ id:inserted[0].id, duplicate:false, name:file.name });
    }
    return json({ saved }, 201);
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { action?:unknown; profileId?:unknown; assetId?:unknown; variantId?:unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    const variantId = typeof body.variantId === "string" ? body.variantId : "";
    if (action !== "LINK_TO_VARIANT" || !uuid(profileId) || !uuid(assetId) || !uuid(variantId)) return json({ error: "ASSET_REUSE_INPUT_INVALID" }, 400);
    if (!await ownsProfile(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    const assets = await sql`
      select id::text,quality_status,identity_status
      from public.assets
      where id=${assetId}::uuid and profile_id=${profileId}::uuid
      limit 1
    ` as unknown as Array<{id:string;quality_status:string;identity_status:string}>;
    if (!assets[0]) return json({ error: "ASSET_NOT_FOUND" }, 404);
    if (assets[0].quality_status === "BLOCK" || assets[0].quality_status === "FAILED") return json({ error: "ASSET_QUALITY_BLOCKED" }, 409);

    const variants = await sql`
      select id::text,content_id::text
      from public.content_variants
      where id=${variantId}::uuid and profile_id=${profileId}::uuid and eligible is true
      limit 1
    ` as unknown as Array<{id:string;content_id:string}>;
    if (!variants[0]) return json({ error: "CONTENT_VARIANT_NOT_FOUND" }, 404);

    await sql`
      update public.content_variants
      set image_asset_id=${assetId}::uuid,
          visual_provider='REAL_ASSET',
          visual_model=null,
          visual_decision_reason='MANUAL_ASSET_REUSE',
          visual_estimated_cost_eur=0,
          visual_actual_cost_eur=0,
          visual_identity_qa_status='NOT_REQUIRED',
          approval_status='PENDING',
          updated_at=now()
      where id=${variantId}::uuid and profile_id=${profileId}::uuid
    `;
    await sql`
      update public.assets
      set reuse_count=reuse_count+1,last_used_at=now(),updated_at=now()
      where id=${assetId}::uuid and profile_id=${profileId}::uuid
    `;
    await sql`
      update public.content_items
      set status='IN_REVIEW',updated_at=now()
      where id=${variants[0].content_id}::uuid and profile_id=${profileId}::uuid
    `;
    return json({ linked:true, assetId, variantId });
  }

  if (request.method === "DELETE") {
    const body = await request.json().catch(() => ({})) as { profileId?:unknown; assetId?:unknown };
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    if (!uuid(profileId) || !uuid(assetId)) return json({ error: "ASSET_REQUIRED" }, 400);
    if (!await ownsProfile(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    const assets = await sql`
      select id::text,publication_usage
      from public.assets
      where id=${assetId}::uuid and profile_id=${profileId}::uuid
      limit 1
    ` as unknown as Array<{id:string;publication_usage:number}>;
    if (!assets[0]) return json({ error: "ASSET_NOT_FOUND" }, 404);
    if (Number(assets[0].publication_usage) > 0) return json({ error: "ASSET_ALREADY_PUBLISHED" }, 409);

    await sql`
      update public.content_variants
      set image_asset_id=null,visual_provider=null,visual_model=null,visual_decision_reason=null,
          visual_estimated_cost_eur=null,visual_actual_cost_eur=null,visual_identity_qa_status=null,
          approval_status='PENDING',updated_at=now()
      where profile_id=${profileId}::uuid and image_asset_id=${assetId}::uuid
    `;
    await sql`delete from public.assets where id=${assetId}::uuid and profile_id=${profileId}::uuid`;
    return json({ deleted:true });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}
