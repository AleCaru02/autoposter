import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./image-generation-metering.js";
import { generateRoutedImage } from "./routed-image.js";
import { imageSizeForFormat } from "./openai-image.js";
import { preflightDeterministicTypography } from "./deterministic-text-compositor.js";
import { imageStorageUrl } from "./image-storage.js";
import { assetContentHashFromBase64 } from "./asset-intelligence.js";
import { assertAutopilotGraphicBrief } from "./visual-headline.js";
import { editorialPlacementForContent } from "./social-creative-direction.js";
import { normalizeBrandVisualIdentity } from "./brand-visual-identity.js";
import { brandTextStyle } from "./brand-visual-assets.js";

/**
 * Exactly one owner-authorized OpenAI image. No content variant, publishing
 * job, schedule, external social write, automatic approval or paid QA.
 * Stable entitlement idempotency ensures each scheduled cron checks but only
 * one actual image can be requested. 18 Nov expiry makes the route inert.
 */
const PROFILE_ID = "73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
const REFERENCE_ID = "e91788af-f507-4d4d-a69c-80b442995c1b";
const STOP_UTC = Date.parse("2026-11-18T08:00:00Z");
const HEADLINE = "La tariffa non è il guadagno";
const CAPTION = [
  "Il prezzo per notte è solo il punto di partenza.",
  "Per capire quanto rende davvero un immobile bisogna considerare commissioni dei portali, pulizie, manutenzione, imposte e periodi non occupati.",
  "Prima di decidere come affittare casa, valuta il risultato netto e le responsabilità operative.",
  "Vuoi una valutazione prudente del tuo immobile a Milano? Contattaci."
].join(" ");
const BRIEF = [
  "Titolo in grafica: «La tariffa non è il guadagno».",
  "OBIETTIVO: rendere visibile in una singola fotografia il lavoro e i costi reali dietro la tariffa di un affitto breve, senza inventare numeri, persone o rendimenti.",
  "SCENA: appartamento moderno ma credibile, esplicitamente illustrativo e NON una proprietà vera del brand.",
  "Nella metà SUPERIORE del frame una sola figura anonima, ripresa di tre quarti e con il volto non riconoscibile, è colta nell'atto concreto di tendere lenzuola di lino fresche su un letto prima dell'arrivo di un ospite.",
  "La parte posteriore della stanza è ordinata e pronta per accogliere ospiti; il gesto di preparazione in primo piano racconta il lavoro invisibile necessario a quel risultato.",
  "ESTETICA: fotografia editoriale di reportage premium 35mm, prospettiva laterale a tre quarti, luce naturale radente, dettagli nitidi, materiali autentici, ombre blu petrolio, crema desaturata e discreti accenti ambra.",
  "LAYOUT 4:5: soggetto e azione nei primi 60% superiori; terzo inferiore più scuro e semplice per la tipografia deterministica, senza simulare uno sfondo vuoto.",
  "VIETATO: chiavi, laptop, quaderno, scrivania, tazze, skyline, finti loghi, testi nella foto, numeri, icone, watermark, collage, grande card bianca, volti riconoscibili e proprietà presentate come reali."
].join(" ");

export type OneImagePreviewState =
  | { state: "INERT" }
  | { state: "BLOCKED"; code: string }
  | { state: "ALREADY_CONSUMED" }
  | { state: "IN_PROGRESS" }
  | { state: "CREATED"; assetId: string; url: string; estimatedCostUsd: number }
  | { state: "FAILED"; code: string };

export async function runOneImageOwnerPreview(env: {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  AUTOPILOT_AI_ENABLED?: string;
  AUTO_SOCIAL_PUBLISH_ENABLED?: string;
  AUTO_REEL_PILOT_ENABLED?: string;
}, now = new Date()): Promise<OneImagePreviewState> {
  if (now.getTime() > STOP_UTC) return { state: "INERT" };
  if (env.AUTOPILOT_AI_ENABLED !== "false"
    || env.AUTO_SOCIAL_PUBLISH_ENABLED !== "false"
    || env.AUTO_REEL_PILOT_ENABLED !== "false")
    return { state: "BLOCKED", code: "OWNER_REVIEW_GUARDS_NOT_ACTIVE" };
  if (!env.DATABASE_URL || !env.OPENAI_API_KEY || !env.BLOB_READ_WRITE_TOKEN)
    return { state: "BLOCKED", code: "PAID_PREVIEW_ENV_NOT_CONFIGURED" };

  const sql = neon(env.DATABASE_URL);
  const profiles = await sql.query(
    "select p.name,p.industry,p.profile_type,b.tone_of_voice,b.visual_identity "
      + "from public.profiles p left join public.brand_profiles b on b.profile_id=p.id "
      + "where p.id=$1::uuid and p.archived_at is null limit 1",
    [PROFILE_ID]
  ) as unknown as Array<{name:string;industry:string|null;profile_type:"BUSINESS"|"PERSONAL_BRAND";
    tone_of_voice:unknown;visual_identity:unknown}>;
  const profile = profiles[0];
  if (!profile) return { state: "BLOCKED", code: "OWNER_PROFILE_NOT_FOUND" };
  const voice = profile.tone_of_voice && typeof profile.tone_of_voice === "object"
    && "summary" in profile.tone_of_voice
    ? String((profile.tone_of_voice as {summary?:unknown}).summary ?? "") : "";
  const visual = normalizeBrandVisualIdentity(profile.visual_identity,profile.industry);
  const palette = visual.activeSocialPalette;
  const layout = editorialPlacementForContent({format:"POST",visualBrief:BRIEF,caption:CAPTION});
  if (layout !== "BOTTOM_GRADIENT" || assertAutopilotGraphicBrief(BRIEF) !== HEADLINE)
    return { state: "BLOCKED", code: "PREVIEW_GRAPHIC_BRIEF_INVALID" };
  const typography = {
    brand: profile.name, headline: HEADLINE, subheadline:null,logoDataUrl:null,
    style: { ...brandTextStyle(palette),brandColor:palette.accent,layout }
  };
  const [width,height] = imageSizeForFormat("POST","FACEBOOK").split("x").map(Number);
  const preflight = await preflightDeterministicTypography({width,height,...typography});
  if (preflight.visualZone.height < height * 0.42 || preflight.textZone.height > height * 0.37)
    return { state: "BLOCKED", code: "PREVIEW_PHOTO_LAYOUT_INVALID" };

  const meter = new ImageGenerationMetering(env.DATABASE_URL);
  const reservation = await meter.reserve({
    profileId: PROFILE_ID,source:"MANUAL",
    operationIdentity:"owner-single-creative-preview-2026-11-17",
    referenceId:REFERENCE_ID,
    requestFingerprint:{profileId:PROFILE_ID,headline:HEADLINE,visualBrief:BRIEF,
      layout,provider:"FACEBOOK",format:"POST",engine:"OPENAI_IMAGES_2"}
  });
  if (reservation.status !== "RESERVED")
    return {state:reservation.status==="IN_PROGRESS"?"IN_PROGRESS":"ALREADY_CONSUMED"};
  const eventId = reservation.eventId;
  let mediaCalls=0,imageCalls=0;
  const onlyOnceFetch:typeof fetch = async (input,init) => {
    const url=String(input);
    if (!url.startsWith("https://api.openai.com/v1/")) throw Error("UNEXPECTED_AI_PROVIDER_HOST");
    if (url.endsWith("/responses") && ++mediaCalls > 1) throw Error("SECOND_MEDIA_MANAGER_CALL_FORBIDDEN");
    if (url.endsWith("/images/generations") && ++imageCalls > 1) throw Error("SECOND_IMAGE_PROVIDER_CALL_FORBIDDEN");
    return fetch(input,init);
  };
  try {
    const budget = await new ActivityBudgetEngine(env.DATABASE_URL).preflight({
      profileId:PROFILE_ID,task:"IMAGE_STANDARD",importance:"STANDARD",
      projectedOperationCostUsd:0.25,costBucket:"OTHER_AI"
    });
    if (!budget.allowed) throw Error(budget.reason ?? "ONE_IMAGE_BUDGET_BLOCKED");
    await meter.markProviderStarted(eventId,0.25);
    const image = await generateRoutedImage({
      env:{OPENAI_API_KEY:env.OPENAI_API_KEY},budget,importance:"STANDARD",
      profileName:profile.name,profileType:profile.profile_type,industry:profile.industry,
      tone:voice,brandColors:[palette.primary,palette.secondary,palette.accent,palette.neutral],
      brandFonts:visual.fonts,brandVisualStyle:visual.visualStyle,
      provider:"FACEBOOK",format:"POST",visualBrief:BRIEF,caption:CAPTION,
      typography,additionalDirection:"Only one authentic operational action; illustration, no fake statistics, property claims, stock keys, laptop, notebooks or large white cards.",
      fetcher:onlyOnceFetch
    });
    if (imageCalls !== 1 || mediaCalls !== 1) throw Error("PROVIDER_CALL_COUNT_MISMATCH");
    const assetId = crypto.randomUUID();
    const stored = await imageStorageUrl({
      profileId:PROFILE_ID,name:assetId,
      bytes:new Uint8Array(Buffer.from(image.base64,"base64")),
      mimeType:image.mimeType,
      env:{BLOB_READ_WRITE_TOKEN:env.BLOB_READ_WRITE_TOKEN}
    });
    if (stored.mode !== "VERCEL_BLOB_PUBLIC_V1") throw Error("PUBLIC_BLOB_REQUIRED");
    console.log("one-image-creative-preview.saved",{assetId,url:stored.storageUrl});
    const cost = image.usage.estimatedCostUsd ?? 0.25;
    const metadata = JSON.stringify({
      provider:"OPENAI",model:image.model,format:image.outputFormat,quality:image.quality,
      estimated_cost_usd:cost,size:image.size,aspect_ratio:image.aspectRatio,
      visual_brief:BRIEF,caption:CAPTION,headline:HEADLINE,layout,
      storage_mode:"VERCEL_BLOB_PUBLIC_V1",owner_approval:"PENDING",
      publisher_enabled:false,prompt_version:image.promptVersion
    });
    await sql.query(
      "insert into public.assets "
        + "(id,profile_id,source,kind,name,storage_url,mime_type,tags,metadata,provider,model,cost_eur,width,height,format,quality_status,identity_status,content_hash,updated_at) "
        + "values ($1::uuid,$2::uuid,'AI_IMAGE','IMAGE',$3,$4,'image/png',$5::jsonb,$6::jsonb,'OPENAI',$7,$8,$9,$10,$11,'PENDING','NOT_REQUIRED',$12,now())",
      [
        assetId,PROFILE_ID,"creative-owner-review-"+assetId+".png",stored.storageUrl,
        JSON.stringify(["AI_GENERATED","MANUAL_PREVIEW","AWAITING_OWNER_REVIEW"]),
        metadata,image.model,cost,width,height,image.aspectRatio,
        await assetContentHashFromBase64(image.base64)
      ]
    );
    await meter.persistTechnicalEvents(PROFILE_ID,eventId,technicalEventsFromImageResult(image,{
      source:"OWNER_APPROVED_ONE_OFF_TEST",provider:"FACEBOOK",format:"POST",published:false
    }));
    await meter.storeResult(eventId,{response:{assetId,url:stored.storageUrl},assetId});
    await meter.commit(eventId);
    console.log("one-image-creative-preview.completed",{
      assetId,url:stored.storageUrl,model:image.model,size:image.size,
      estimatedCostUsd:cost,mediaCalls,imageCalls,published:false,approval:"PENDING"
    });
    return {state:"CREATED",assetId,url:stored.storageUrl,estimatedCostUsd:cost};
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "UNKNOWN";
    const code = /^[A-Z0-9_]+/.exec(message)?.[0] ?? "ONE_IMAGE_RUNTIME_ERROR";
    await meter.release(eventId,code).catch(()=>undefined);
    console.error("one-image-creative-preview.failed",{code,mediaCalls,imageCalls});
    return {state:"FAILED",code};
  }
}
