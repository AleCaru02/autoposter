import { neon } from "@neondatabase/serverless";
import { runContentQa } from "../api/_lib/content-qa.js";
import { socialSafeModeState, type SocialEnv } from "../api/_lib/social.js";
import { estimateImageCostUsd } from "../api/_lib/openai-image.js";
import { ImageGenerationMetering } from "../api/_lib/image-generation-metering.js";
import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { normalizeBrandVisualIdentity } from "../api/_lib/brand-visual-identity.js";
import { assetContentHashFromBase64, visualFingerprint } from "../api/_lib/asset-intelligence.js";

type Env = Pick<SocialEnv,"SAFE_MODE"> & {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  PREPUBLISH_QA_TOKEN?: string;
};

type CandidateRow = {
  job_id:string;
  profile_name:string;
  industry:string|null;
  profile_type:"BUSINESS"|"PERSONAL_BRAND";
  provider:"FACEBOOK"|"INSTAGRAM"|"LINKEDIN"|"GBP";
  format:"POST"|"CAROUSEL"|"STORY";
  content_title:string|null;
  content_topic:string;
  source_refs:unknown;
  hook:string|null;
  caption:string|null;
  cta:string|null;
  current_asset_id:string|null;
  current_asset_name:string|null;
  current_asset_provider:string|null;
  current_asset_model:string|null;
  current_asset_quality_status:string|null;
  current_asset_identity_status:string|null;
  current_asset_metadata:unknown;
  account_name:string|null;
  connection_status:string|null;
  provider_account_id:string|null;
  tone_of_voice:unknown;
  visual_identity:unknown;
};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_VISUAL_VERSION="CITYLIFE_PREPUBLISH_SAFE_V5";
const SAFE_VISUAL_BRIEF=[
  "Grafica editoriale quadrata premium per Facebook dedicata a CityLife/Fiera e agli affitti brevi.",
  "NON usare mappe, cartografia, planimetrie, percorsi, linee di trasporto, pin, nomi di vie o relazioni geografiche.",
  "NON riprodurre edifici reali riconoscibili o skyline specifici.",
  "Costruisci invece una composizione editoriale astratta ispirata all'architettura contemporanea: volumi geometrici tridimensionali morbidi, una griglia-calendario astratta senza date né numeri e un elemento casa/appartamento stilizzato integrati in modo sofisticato.",
  "La grafica deve comunicare visivamente che il calendario eventi è solo una parte della valutazione, senza inventare dati.",
  "Titolo esatto: “CityLife/Fiera: il calendario eventi non basta”.",
  "Sottotitolo esatto: “Conta anche la domanda fuori evento”.",
  "Palette chiara e neutra con accento blu, gerarchia editoriale forte, testo leggibile su smartphone, molto spazio respirato.",
  "Nessun altro testo, numero, logo, marchio, recensione, dato, percentuale o icona decorativa casuale.",
].join(" ");

const SAFE_ALT_TEXT="Grafica editoriale astratta su CityLife/Fiera con volumi architettonici geometrici e un calendario stilizzato, senza mappa né percorsi reali, con il titolo “CityLife/Fiera: il calendario eventi non basta”.";

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

function authorized(request:Request,env:Env){
  const expected=env.PREPUBLISH_QA_TOKEN?.trim();
  if(!expected) return false;
  return request.headers.get("x-prepublish-qa-token")?.trim()===expected;
}

function toneSummary(value:unknown){
  if(typeof value==="string") return value.trim().slice(0,800)||null;
  if(value && typeof value==="object" && !Array.isArray(value)){
    const row=value as Record<string,unknown>;
    for(const key of ["summary","tone","description"]){
      if(typeof row[key]==="string" && row[key].trim()) return row[key].trim().slice(0,800);
    }
  }
  return null;
}

async function loadCandidate(sql:ReturnType<typeof neon>,profileId:string,contentId:string,variantId:string){
  const rows=await sql`
    select
      j.id::text as job_id,
      p.name as profile_name,
      p.industry,
      p.profile_type,
      v.provider,
      v.format,
      ci.title as content_title,
      ci.topic as content_topic,
      ci.source_refs,
      v.hook,
      v.caption,
      v.cta,
      v.image_asset_id::text as current_asset_id,
      a.name as current_asset_name,
      a.provider as current_asset_provider,
      a.model as current_asset_model,
      a.quality_status as current_asset_quality_status,
      a.identity_status as current_asset_identity_status,
      a.metadata as current_asset_metadata,
      sc.account_name,
      sc.status as connection_status,
      sc.provider_account_id,
      b.tone_of_voice,
      b.visual_identity
    from public.publication_jobs j
    join public.content_variants v on v.id=j.variant_id and v.profile_id=j.profile_id
    join public.content_items ci on ci.id=v.content_id and ci.profile_id=v.profile_id
    join public.profiles p on p.id=j.profile_id
    left join public.assets a on a.id=v.image_asset_id and a.profile_id=v.profile_id
    left join public.social_connections sc on sc.profile_id=v.profile_id and sc.provider=v.provider
    left join public.brand_profiles b on b.profile_id=v.profile_id
    where j.profile_id=${profileId}::uuid
      and j.variant_id=${variantId}::uuid
      and v.content_id=${contentId}::uuid
      and j.state='BLOCKED_APPROVAL'
      and j.execution_mode='REAL_EXTERNAL'
      and j.attempt_count=0
      and j.remote_post_id is null
      and j.published_at is null
      and v.approval_mode='MANUAL'
      and v.approval_status='PENDING'
      and v.workflow_status in ('REVIEW','REVIEW_REQUIRED')
      and v.approved_by is null
      and v.approved_at is null
      and v.external_post_id is null
      and v.published_at is null
    limit 1
  ` as unknown as CandidateRow[];
  return rows[0]??null;
}

function metadataObject(value:unknown):Record<string,unknown>{
  return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}

function numeric(value:unknown){
  return typeof value==="number" && Number.isFinite(value) ? value : null;
}

async function generateConfirmedBriefImage(apiKey:string){
  const prompt=[
    SAFE_VISUAL_BRIEF,
    "Usa esclusivamente questi contenuti e vincoli già confermati. Non aggiungere fatti, luoghi, dati, label, loghi o claim.",
    "Il testo visibile deve essere esattamente quello richiesto nel brief, in italiano naturale e perfettamente leggibile su smartphone.",
    "Evita totalmente qualsiasi elemento che possa sembrare cartografia reale. La composizione deve essere editoriale, astratta e chiaramente illustrativa, non una rappresentazione geografica.",
  ].join("\n\n");
  let response:Response|null=null;
  let raw="";
  for(let attempt=1;attempt<=3;attempt+=1){
    response=await fetch("https://api.openai.com/v1/images/generations",{
      method:"POST",
      headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},
      body:JSON.stringify({model:"gpt-image-2",prompt,size:"1024x1024",quality:"high",n:1,output_format:"png"}),
    });
    raw=await response.text();
    if(response.ok) break;
    if(response.status!==429 || attempt===3) throw new Error(`OPENAI_IMAGE_HTTP_${response.status}`);
    const retryAfter=Number(response.headers.get("retry-after")??"0");
    const delayMs=Math.min(Math.max(Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:attempt*2000,1000),8000);
    await new Promise((resolve)=>setTimeout(resolve,delayMs));
  }
  if(!response?.ok) throw new Error(`OPENAI_IMAGE_HTTP_${response?.status??"UNKNOWN"}`);
  const requestId=response.headers.get("x-request-id");
  const body=JSON.parse(raw) as Record<string,unknown>;
  const rows=Array.isArray(body.data)?body.data:[];
  const first=rows[0] && typeof rows[0]==="object" ? rows[0] as Record<string,unknown> : null;
  const base64=first && typeof first.b64_json==="string" ? first.b64_json : "";
  if(!base64) throw new Error("OPENAI_IMAGE_EMPTY_OUTPUT");
  const usage=body.usage && typeof body.usage==="object" ? body.usage as Record<string,unknown> : {};
  const inputTokens=numeric(usage.input_tokens);
  const outputTokens=numeric(usage.output_tokens);
  const estimatedCostUsd=inputTokens!==null && outputTokens!==null ? estimateImageCostUsd(inputTokens,outputTokens) : null;
  return {
    model:"gpt-image-2" as const,mimeType:"image/png" as const,base64,
    size:"1024x1024" as const,aspectRatio:"1:1" as const,quality:"high" as const,
    generationPrompt:prompt,requestId,usage:{estimatedCostUsd},
    technicalEvents:[{
      operation:"GENERATE_SOCIAL_IMAGE" as const,model:"gpt-image-2",
      inputTokens,outputTokens,costUsd:estimatedCostUsd,
      metadata:{openai_request_id:requestId,quality:"high",size:"1024x1024",prepublish_direct_confirmed_brief:true},
    }],
  };
}

async function regenerateSafeVisual(input:{
  env:Env;
  sql:ReturnType<typeof neon>;
  profileId:string;
  contentId:string;
  variantId:string;
  candidate:CandidateRow;
}){
  const {env,sql,profileId,contentId,variantId,candidate}=input;
  const existingMeta=metadataObject(candidate.current_asset_metadata);
  if(existingMeta.prepublish_visual_version===SAFE_VISUAL_VERSION){
    return {regenerated:false,assetId:candidate.current_asset_id,reason:"SAFE_VISUAL_ALREADY_LINKED"};
  }
  if(candidate.provider!=="FACEBOOK" || candidate.format!=="POST" || candidate.profile_type!=="BUSINESS"){
    throw new Error("PREPUBLISH_VISUAL_SCOPE_MISMATCH");
  }

  const operationIdentity=`prepublish-visual:${variantId}:${SAFE_VISUAL_VERSION}`;
  const meter=new ImageGenerationMetering(env.DATABASE_URL!);
  const reservation=await meter.reserve({
    profileId,
    source:"MANUAL",
    operationIdentity,
    referenceId:variantId,
    requestFingerprint:{
      contentId,variantId,provider:candidate.provider,format:candidate.format,
      visualBrief:SAFE_VISUAL_BRIEF,version:SAFE_VISUAL_VERSION,
    },
  });
  if(reservation.status==="DENIED") throw new Error(reservation.code);
  if(reservation.status==="IN_PROGRESS") throw new Error("IMAGE_GENERATION_IN_PROGRESS");
  if(reservation.status==="RELEASED") throw new Error("METERING_FAILED");
  if(reservation.status==="COMPLETED"){
    const assetId=typeof reservation.cached.assetId==="string"?reservation.cached.assetId:null;
    if(!assetId) throw new Error("CACHED_SAFE_VISUAL_MISSING");
    const linked=await sql`
      update public.content_variants
      set image_asset_id=${assetId}::uuid,
          visual_brief=${SAFE_VISUAL_BRIEF},
          alt_text=${SAFE_ALT_TEXT},
          approval_status='PENDING',
          visual_generation_status='PASS',
          visual_generation_error=null,
          visual_generation_operation_id=${operationIdentity},
          visual_generation_updated_at=now(),
          updated_at=now()
      where id=${variantId}::uuid and profile_id=${profileId}::uuid
        and approval_status='PENDING' and approved_by is null and external_post_id is null
      returning id
    `;
    if(!linked.length) throw new Error("CACHED_SAFE_VISUAL_LINK_FAILED");
    return {regenerated:false,assetId,reason:"SAFE_VISUAL_RELINKED_FROM_METER"};
  }

  const eventId=reservation.eventId;
  let committed=false;
  try{
    const budget=await new ActivityBudgetEngine(env.DATABASE_URL!).preflight({
      profileId,task:"IMAGE_STANDARD",importance:"STANDARD",projectedOperationCostUsd:0.25,
    });
    if(!budget.allowed){
      await meter.release(eventId,budget.reason??"AI_BUDGET_HARD_STOP");
      throw new Error(budget.reason??"AI_BUDGET_HARD_STOP");
    }

    await meter.markProviderStarted(eventId,0.25);
    const brandVisual=normalizeBrandVisualIdentity(candidate.visual_identity);
    const result=await generateConfirmedBriefImage(env.OPENAI_API_KEY!);
    if(result.model!=="gpt-image-2") throw new Error("PREPUBLISH_IMAGE_MODEL_MISMATCH");

    await meter.persistTechnicalEvents(profileId,eventId,result.technicalEvents.map((event)=>({
      ...event,
      metadata:{source:"MANUAL",provider:candidate.provider,format:candidate.format,purpose:"FIRST_REAL_PREPUBLISH_QA",...event.metadata},
    })));

    const actualRows=await sql`
      select coalesce(actual_usd,reserved_usd)*fx_usd_to_eur_rate as actual_eur
      from public.provider_cost_attempts
      where logical_usage_event_id=${eventId}::uuid
      limit 1
    ` as unknown as Array<{actual_eur:number|string}>;
    const actualEur=Number(actualRows[0]?.actual_eur??Number(result.usage.estimatedCostUsd??0.25)*budget.usdToEurRate);
    const sizeMatch=/^(\d+)x(\d+)$/.exec(String(result.size??""));
    const dataUrl=`data:${result.mimeType};base64,${result.base64}`;
    const contentHash=await assetContentHashFromBase64(result.base64);
    const fingerprint=await visualFingerprint({visualBrief:SAFE_VISUAL_BRIEF,aspectRatio:result.aspectRatio});
    const metadata={
      provider:"OPENAI",model:result.model,profile_type:candidate.profile_type,quality:result.quality,
      size:result.size,aspect_ratio:result.aspectRatio,visual_brief:SAFE_VISUAL_BRIEF,
      visual_fingerprint:fingerprint,brand_palette:brandVisual.colors,brand_fonts:brandVisual.fonts,
      brand_visual_style:brandVisual.visualStyle,generation_prompt:result.generationPrompt.slice(0,8000),
      provider_request_id:result.requestId,storage_mode:"DATABASE_DATA_URL_V1",
      prepublish_visual_version:SAFE_VISUAL_VERSION,
    };
    const assetRows=await sql`
      insert into public.assets(
        profile_id,content_id,source,kind,name,storage_url,mime_type,tags,metadata,
        provider,model,cost_eur,width,height,format,quality_status,identity_status,content_hash,updated_at
      ) values (
        ${profileId}::uuid,${contentId}::uuid,'AI_IMAGE','IMAGE',
        ${`FACEBOOK-POST-${variantId}-safe-v5.png`},${dataUrl},${result.mimeType},
        ${JSON.stringify(["FACEBOOK","POST","AI_GENERATED","PREPUBLISH_SAFE"])}::jsonb,
        ${JSON.stringify(metadata)}::jsonb,
        'OPENAI',${result.model},${actualEur},
        ${sizeMatch?Number(sizeMatch[1]):null},${sizeMatch?Number(sizeMatch[2]):null},
        ${result.aspectRatio},'PENDING','NOT_REQUIRED',${contentHash},now()
      )
      returning id::text
    ` as unknown as Array<{id:string}>;
    const assetId=assetRows[0]?.id;
    if(!assetId) throw new Error("SAFE_VISUAL_ASSET_WRITE_FAILED");

    const linked=await sql`
      update public.content_variants
      set image_asset_id=${assetId}::uuid,
          visual_brief=${SAFE_VISUAL_BRIEF},
          alt_text=${SAFE_ALT_TEXT},
          approval_status='PENDING',
          visual_generation_status='PASS',
          visual_generation_error=null,
          visual_generation_operation_id=${operationIdentity},
          visual_generation_updated_at=now(),
          updated_at=now()
      where id=${variantId}::uuid and content_id=${contentId}::uuid and profile_id=${profileId}::uuid
        and approval_status='PENDING' and approved_by is null and external_post_id is null
      returning id
    `;
    if(!linked.length) throw new Error("SAFE_VISUAL_LINK_FAILED");

    await meter.storeResult(eventId,{response:{model:result.model,size:result.size,quality:result.quality},assetId,variantId});
    await meter.commit(eventId);
    committed=true;
    return {regenerated:true,assetId,model:result.model,size:result.size,costEur:actualEur};
  }catch(reason){
    if(!committed) await meter.release(eventId,reason instanceof Error?reason.message:"SAFE_VISUAL_FAILED").catch(()=>undefined);
    throw reason;
  }
}

export async function handleControlledPrepublishQa(request:Request,env:Env){
  if(!env.PREPUBLISH_QA_TOKEN) return json({error:"API_NOT_FOUND"},404);
  if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
  if(!authorized(request,env)) return json({error:"API_NOT_FOUND"},404);
  if(socialSafeModeState(env)!=="ON") return json({error:"SAFE_MODE_REQUIRED"},409);
  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},503);
  if(!env.OPENAI_API_KEY) return json({error:"OPENAI_NOT_CONFIGURED"},503);

  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const profileId=typeof body?.profileId==="string"?body.profileId:"";
  const contentId=typeof body?.contentId==="string"?body.contentId:"";
  const variantId=typeof body?.variantId==="string"?body.variantId:"";
  const action=body?.action==="REGENERATE_VISUAL_AND_QA"?"REGENERATE_VISUAL_AND_QA":"QA_ONLY";
  if(![profileId,contentId,variantId].every((value)=>UUID.test(value))) return json({error:"CONTENT_QA_INPUT_INVALID"},400);

  const sql=neon(env.DATABASE_URL);
  const candidate=await loadCandidate(sql,profileId,contentId,variantId);
  if(!candidate) return json({error:"PREPUBLISH_CANDIDATE_NOT_SAFE"},409);

  try{
    const visual=action==="REGENERATE_VISUAL_AND_QA"
      ? await regenerateSafeVisual({env,sql,profileId,contentId,variantId,candidate})
      : null;
    const qa=await runContentQa({
      databaseUrl:env.DATABASE_URL,
      apiKey:env.OPENAI_API_KEY,
      profileId,
      contentId,
      variantId,
      actorType:"SYSTEM",
      authUserId:null,
      force:true,
    });
    const prepared=await loadCandidate(sql,profileId,contentId,variantId)??candidate;
    return json({
      safeMode:true,
      publicationJobId:prepared.job_id,
      candidate:{
        profileName:prepared.profile_name,
        profileType:prepared.profile_type,
        platform:prepared.provider,
        format:prepared.format,
        title:prepared.content_title,
        topic:prepared.content_topic,
        hook:prepared.hook,
        caption:prepared.caption,
        cta:prepared.cta,
        accountName:prepared.account_name,
        connectionStatus:prepared.connection_status,
        asset:{
          id:prepared.current_asset_id,
          name:prepared.current_asset_name,
          provider:prepared.current_asset_provider,
          model:prepared.current_asset_model,
          qualityStatus:prepared.current_asset_quality_status,
          identityStatus:prepared.current_asset_identity_status,
        },
        sourceRefs:prepared.source_refs,
        approvalStatus:"PENDING",
        workflowStatus:"REVIEW",
      },
      visual,
      qa,
    });
  }catch(reason){
    const code=reason instanceof Error?reason.message.split(":")[0]:"CONTENT_QA_FAILED";
    console.error("controlled-prepublish-qa",{profileId,contentId,variantId,action,code});
    return json({error:code},500);
  }
}
