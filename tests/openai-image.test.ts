import assert from "node:assert/strict";
import fs from "node:fs";
import { buildImagePrompt, estimateImageCost, estimateImageCostUsd, generateOpenAIImage, imageAspectRatioForFormat, imageSizeForFormat } from "../api/_lib/openai-image.js";
import { normalizeBrandVisualIdentity } from "../api/_lib/brand-visual-identity.js";
import { estimateTerraCostUsd } from "../api/_lib/openai-text.js";
import { selectCreativeTemplate, editorialPlacementForContent, socialCreativeDirection, socialCopySkillPrompt, creativeConceptIssues } from "../api/_lib/social-creative-direction.js";
import { assertAutopilotGraphicBrief, explicitGraphicHeadline, visualHeadlineForBrief } from "../api/_lib/visual-headline.js";

const calls: Array<{ url: string; body: Record<string, any>; headers: Record<string, string> }> = [];
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const resolved = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
  calls.push({ url: resolved, body, headers: init?.headers as Record<string, string> });
  if (resolved.endsWith("/v1/responses")) {
    return new Response(JSON.stringify({
      id: "resp_media_test",
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({
        visualIntent: "Trasmettere ordine e professionalità",
        composition: "Ambiente luminoso con punto focale centrale",
        subject: "Interno ordinato di un appartamento contemporaneo",
        environment: "Spazio realistico, pulito e abitabile",
        style: "Fotografia editoriale credibile e premium",
        imagePrompt: "PROMPT MEDIA MANAGER: interno luminoso, realistico, ordinato, composizione quadrata professionale, nessun testo o logo",
        altText: "Interno luminoso e ordinato di un appartamento",
        avoid: ["testo", "loghi", "watermark"],
      }),
      usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
    }), { status: 200, headers: { "x-request-id": "req_media_test", "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ created: 1, data: [{ b64_json: Buffer.from("fake-png").toString("base64"), revised_prompt: "Professional property image" }], usage: { input_tokens: 50, output_tokens: 1200, total_tokens: 1250 } }), { status: 200, headers: { "x-request-id": "req_image_test", "content-type": "application/json" } });
}) as typeof fetch;

assert.equal(imageSizeForFormat("POST", "LINKEDIN"), "2048x2048");
assert.equal(imageSizeForFormat("POST", "INSTAGRAM"), "1536x1920");
assert.equal(imageSizeForFormat("CAROUSEL", "FACEBOOK"), "1536x1920");
assert.equal(imageSizeForFormat("STORY", "INSTAGRAM"), "1440x2560");
assert.equal(imageAspectRatioForFormat("POST", "INSTAGRAM"), "4:5");
assert.equal(imageAspectRatioForFormat("STORY", "INSTAGRAM"), "9:16");

assert.equal(selectCreativeTemplate({format:"POST",visualBrief:"Non guardare solo la tariffa: redditività reale"}),"ECONOMICS_CONTRAST");
assert.equal(editorialPlacementForContent({format:"POST",visualBrief:"Non guardare solo la tariffa: redditività reale"}),"EDITORIAL_SPLIT");
assert.equal(editorialPlacementForContent({format:"POST",visualBrief:"Organizzare check-in e pulizie"}),"TOP_GRADIENT");
assert.equal(editorialPlacementForContent({format:"STORY",visualBrief:"Tariffe"}),"BOTTOM_GRADIENT");
const onImageBrief = 'Titolo in grafica: «Non guardare solo la tariffa». Scena editoriale sul confronto fra ricavo lordo e costi operativi reali di una locazione breve.';
assert.equal(explicitGraphicHeadline(onImageBrief),"Non guardare solo la tariffa");
assert.equal(assertAutopilotGraphicBrief(onImageBrief),"Non guardare solo la tariffa");
assert.equal(visualHeadlineForBrief(onImageBrief,"Caption molto più lunga"),"Non guardare solo la tariffa");
assert.throws(()=>assertAutopilotGraphicBrief("Un elegante appartamento luminoso con chiavi, agenda e laptop"),/AUTOPILOT_GRAPHIC_BRIEF_INCOMPLETE/);
assert.throws(()=>assertAutopilotGraphicBrief('Titolo in grafica: «Gestione completa di un affitto breve a Milano: cosa può includere, in concreto?» Scena realistica che mostra gestore e check-in.'),/AUTOPILOT_GRAPHIC_BRIEF_INCOMPLETE/);
assert.equal(selectCreativeTemplate({format:"POST",visualBrief:"Gestione check-in e pulizia"}),"PROCESS_PROOF");
assert.match(socialCreativeDirection({profileName:"Il Tuo Property Manager",provider:"FACEBOOK",format:"POST",visualBrief:"Tariffa contro margine",placement:"EDITORIAL_SPLIT"}),/55% SINISTRO/);
assert.match(socialCreativeDirection({profileName:"Il Tuo Property Manager",provider:"FACEBOOK",format:"POST",visualBrief:"Tariffa contro margine",placement:"EDITORIAL_SPLIT"}),/45% DESTRO/);
assert.equal(selectCreativeTemplate({format:"CAROUSEL",visualBrief:"Tariffe e costi"}),"CAROUSEL_STEP");
assert.equal(selectCreativeTemplate({format:"STORY",visualBrief:"Tariffe"}),"STORY_HERO");
assert.match(socialCreativeDirection({profileName:"Il Tuo Property Manager",industry:"Affitti brevi",provider:"FACEBOOK",format:"POST",visualBrief:"Non guardare solo la tariffa"}),/vietate aree enormi/i);
assert.match(socialCopySkillPrompt(),/3 aperture con meccanismi diversi/);
const mediaDirectorSource = fs.readFileSync("api/_lib/openai-media-manager.ts","utf8");
const textDirectorSource = fs.readFileSync("api/_lib/openai-text.ts","utf8");
assert.match(mediaDirectorSource,/socialCreativeDirection\(input\)/);
assert.match(textDirectorSource,/socialCopySkillPrompt\(\)/);
const imageDirectorSource = fs.readFileSync("api/_lib/openai-image.ts","utf8");
assert.match(imageDirectorSource,/await preflightDeterministicTypography/);
assert.ok(imageDirectorSource.indexOf("await preflightDeterministicTypography") < imageDirectorSource.indexOf("await runOpenAIMediaManager"),"no billable media agent before typography geometry passes");

const normalizedBrand = normalizeBrandVisualIdentity({
  observedColors: ["#112233", "#F5F1E8", "var(--accent)", "#112233"],
  observedFonts: ["Inter", "Inter", "Georgia"],
  summary: "Minimal, premium, sobrio.",
});
assert.deepEqual(normalizedBrand.colors, ["#112233", "#F5F1E8"]);
assert.deepEqual(normalizedBrand.fonts, ["Inter", "Georgia"]);
assert.equal(normalizedBrand.visualStyle, "Minimal, premium, sobrio.");

const prompt = buildImagePrompt({
  profileName: "QA Property",
  profileType: "PERSONAL_BRAND",
  industry: "Property management",
  tone: "Professionale",
  brandColors: ["#112233", "#F5F1E8"],
  brandFonts: ["Inter", "Georgia"],
  brandVisualStyle: "Minimal, premium, sobrio.",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Appartamento luminoso e ordinato",
  caption: "Gestione professionale degli affitti brevi.",
  additionalDirection: null,
});
assert.ok(prompt.includes("Appartamento luminoso"));
const photoLedPrompt = buildImagePrompt({
  profileName:"Il Tuo Property Manager",profileType:"BUSINESS",industry:"Property management",tone:"Professional",
  brandColors:["#17324d","#c9923d"],brandFonts:["Inter"],provider:"FACEBOOK",format:"POST",
  visualBrief:onImageBrief,caption:"Costi di gestione e margine reale",
  typography:{brand:"Il Tuo Property Manager",headline:"Non guardare solo la tariffa",style:{layout:"BOTTOM_GRADIENT"}},
});
assert.match(photoLedPrompt,/TERZO INFERIORE/);
assert.match(photoLedPrompt,/primi 60% superiori/);
assert.doesNotMatch(photoLedPrompt,/Riserva una zona editoriale pulita nel TERZO SUPERIORE/);

assert.match(prompt, /SISTEMA VISIVO PERSONAL BRAND/);
assert.match(prompt, /feed editoriale coerente/i);
assert.match(prompt, /Non inventare il volto del titolare/i);
assert.match(prompt, /colori, font e stile devono provenire dal profilo attivo/i);
assert.match(prompt, /Palette del profilo da rispettare: #112233, #F5F1E8/);
assert.match(prompt, /Inter, Georgia/);
assert.match(prompt, /Minimal, premium, sobrio/);
assert.match(prompt, /non inventare cartografia/i);
assert.match(prompt, /VISUAL = sintesi/i);
assert.match(prompt, /NON renderizzare testo, lettere, numeri, loghi/i);
assert.match(prompt, /zona editoriale pulita/i);
assert.ok(prompt.includes("primo piano, piano intermedio, sfondo"));
assert.ok(prompt.includes("illuminazione"));

const result = await generateOpenAIImage({
  apiKey: "sk-image-test-only",
  profileName: "QA Property",
  profileType: "PERSONAL_BRAND",
  industry: "Property management",
  tone: "Professionale",
  brandColors: ["#112233", "#F5F1E8"],
  brandFonts: ["Inter", "Georgia"],
  brandVisualStyle: "Minimal, premium, sobrio.",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Appartamento luminoso e ordinato",
  caption: "Gestione professionale degli affitti brevi.",
  fetcher,
});

let providerCallsOnInvalidLayout = 0;
await assert.rejects(
  () => generateOpenAIImage({
    apiKey:"sk-test-only",profileName:"Il Tuo Property Manager",profileType:"BUSINESS",
    industry:"Property management",tone:"Professionale",provider:"FACEBOOK",format:"POST",
    visualBrief:"Foto appartamento con agenda",caption:"Descrizione",
    typography:{brand:"Il Tuo Property Manager",headline:"Gestione completa di un affitto breve a Milano: cosa può includere, in concreto?",style:{layout:"TOP_GRADIENT"}},
    fetcher: (async () => {providerCallsOnInvalidLayout+=1; throw Error("PAID_PROVIDER_MUST_NOT_BE_CALLED");}) as typeof fetch,
  }), /TEXT_FIT_FAIL/,
);
assert.equal(providerCallsOnInvalidLayout,0,"no billable OpenAI Media Manager/Images call for malformed social cover");

assert.equal(calls.length, 2, "ogni immagine effettiva deve passare prima dal Media Manager e poi da Sunburst");
assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
assert.equal(calls[0].body.model, "gpt-5.6-terra");
assert.equal(calls[0].body.store, false);
assert.equal(calls[0].body.reasoning.effort, "low");
assert.match(String(calls[0].body.instructions), /non limitarti a riscrivere o allungare il brief/i);
assert.match(String(calls[0].body.instructions), /primo piano, piano intermedio e sfondo/i);
assert.match(String(calls[0].body.instructions), /illuminazione, ombre e atmosfera/i);
assert.match(String(calls[0].body.instructions), /700-1800 caratteri/i);
assert.match(String(calls[0].body.instructions), /NON inventare cartografia/i);
assert.match(String(calls[0].body.instructions), /VISUAL = sintesi/i);
assert.match(String(calls[0].body.instructions), /Non generare testo nell'immagine/i);
assert.match(String(calls[0].body.instructions), /props stock-like/i);
assert.match(String(calls[0].body.instructions), /STRATEGIA VISUAL Instagram/);
assert.match(String(calls[0].body.instructions), /fermare lo scroll/i);
assert.match(String(calls[0].body.instructions), /SISTEMA VISIVO PERSONAL BRAND/);
assert.match(String(calls[0].body.instructions), /feed editoriale coerente/i);
const mediaInput = JSON.parse(String(calls[0].body.input));
assert.deepEqual(mediaInput.brand.colors, ["#112233", "#F5F1E8"]);
assert.deepEqual(mediaInput.brand.fonts, ["Inter", "Georgia"]);
assert.equal(mediaInput.brand.visualStyle, "Minimal, premium, sobrio.");
assert.equal(mediaInput.brand.profileType, "PERSONAL_BRAND");
assert.equal("tools" in calls[0].body, false, "Media Manager non deve spendere per web search");
assert.equal(calls[1].url, "https://api.openai.com/v1/images/generations");
assert.equal(calls[1].headers.authorization, "Bearer sk-image-test-only");
assert.equal(calls[1].body.model, "gpt-image-2.5-sunburst", "i pixel finali devono essere generati esclusivamente da Sunburst");
assert.equal(calls[1].body.quality, "high");
assert.equal(calls[1].body.size, "1536x1920");
assert.equal(calls[1].body.n, 1);
assert.equal(calls[1].body.output_format, "png");
assert.match(calls[1].body.prompt, /PROMPT MEDIA MANAGER/);
assert.ok(String(calls[1].body.prompt).length >= 600, "un prompt visuale troppo corto deve essere arricchito prima di Sunburst");
assert.match(String(calls[1].body.prompt), /Composizione e gerarchia:/);
assert.match(String(calls[1].body.prompt), /Stile, luce e atmosfera:/);
assert.match(String(calls[1].body.prompt), /Palette del profilo da rispettare: #112233, #F5F1E8/);
assert.match(String(calls[1].body.prompt), /non inventare cartografia/i);
assert.match(String(calls[1].body.prompt), /VISUAL = sintesi/i);
assert.match(String(calls[1].body.prompt), /NON renderizzare testo, lettere, numeri, loghi/i);
assert.match(String(calls[1].body.prompt), /props generici o stock-like/i);
assert.match(String(calls[1].body.prompt), /STRATEGIA VISUAL Instagram/);
assert.match(String(calls[1].body.prompt), /fermare lo scroll/i);
assert.match(String(calls[1].body.prompt), /SISTEMA VISIVO PERSONAL BRAND/);
assert.match(String(calls[1].body.prompt), /Non inventare il volto del titolare/i);
assert.equal(JSON.stringify(calls.map((call) => call.body)).includes("sk-image-test-only"), false, "la chiave non deve entrare nei body/prompt");

const mediaCost = estimateTerraCostUsd(100, 80);
const imageCost = estimateImageCostUsd(50, 1200);
assert.equal(result.model, "gpt-image-2.5-sunburst");
assert.equal(result.mediaManager.model, "gpt-5.6-terra");
assert.equal(result.mediaManager.responseId, "resp_media_test");
assert.equal(result.mediaManager.requestId, "req_media_test");
assert.equal(result.quality, "high");
assert.equal(result.outputFormat, "png");
assert.equal(result.promptVersion, "2026-10-11-images-2.5");
assert.equal(result.mimeType, "image/png");
assert.equal(result.requestId, "req_image_test");
assert.match(result.generationPrompt, /Palette del profilo da rispettare/);
assert.match(result.generationPrompt, /non inventare cartografia/i);
assert.equal(result.textCompositor, null, "the direct library path remains composable only when a locked text spec is supplied by the product route");
assert.equal(Buffer.from(result.base64, "base64").toString(), "fake-png");
assert.ok(typeof imageCost === "number" && imageCost > 0, "image cost is priced from usage");
assert.equal(result.usage.mediaManagerCostUsd, mediaCost);
assert.equal(result.usage.inputTokens, 150);
assert.equal(result.usage.outputTokens, 1280);
assert.equal(result.usage.totalTokens, 1430);
assert.ok(Math.abs((result.usage.estimatedCostUsd ?? 0) - (mediaCost + imageCost)) < 1e-9, "image cost is counted (no more null)");
assert.ok(Math.abs(imageCost - (50 * 8 + 1200 * 30) / 1_000_000) < 1e-9, "without an input split every input token is priced at the higher image-input rate (prudent)");

const billingCalls: Array<Record<string, any>> = [];
const billingFetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const resolved = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
  billingCalls.push(body);
  if (resolved.endsWith("/v1/responses")) return fetcher(url, init);
  return new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429, headers: { "content-type": "application/json" } });
}) as typeof fetch;
await assert.rejects(
  () => generateOpenAIImage({
    apiKey: "sk-image-test-only", profileName: "QA Property", profileType: "BUSINESS", industry: null, tone: null,
    provider: "LINKEDIN", format: "POST", visualBrief: "Visual professionale", fetcher: billingFetcher,
  }),
  /OPENAI_IMAGE_HTTP_429_INSUFFICIENT_QUOTA/,
);
assert.equal(billingCalls.filter((body) => body.model === "gpt-image-2.5-sunburst").length, 1, "quota exhausted must not retry or fall back to a legacy model");
assert.equal(billingCalls.some((body) => body.model === "gpt-image-2"), false);

const workerRuntime = fs.readFileSync("cloudflare/worker.ts", "utf8");
assert.match(workerRuntime, /select=id,name,industry,profile_type/, "production Worker image route must load profile type");
assert.match(workerRuntime, /select=tone_of_voice,visual_identity/, "production Worker image route must load the selected profile visual identity");
assert.match(workerRuntime, /text_compositor: result\.textCompositor/, "production Worker must persist deterministic typography metadata");
assert.match(workerRuntime, /profileType:\s*profile\.profile_type/, "production Worker must propagate Personal Brand vs Business");
assert.match(workerRuntime, /brandColors:\s*\[brandVisual\.activeSocialPalette\.primary/, "production Worker must pass the active profile palette to OpenAI Images");
assert.match(workerRuntime, /brandFonts:\s*brandVisual\.fonts/, "production Worker must pass profile fonts to OpenAI Images");
assert.match(workerRuntime, /brandVisualStyle:\s*brandVisual\.visualStyle/, "production Worker must pass profile visual style to OpenAI Images");

// An editorial concept must demonstrate the point and protect the only
// visible 45% of the photo. A generic stock interior may never trigger Images 2.
const rejected = creativeConceptIssues({
  placement:"EDITORIAL_SPLIT",visualIntent:"Ambiente elegante e ordinato",
  subject:"Una camera luminosa con laptop e chiavi",composition:"Soggetto centrale",
  imagePrompt:"Foto corporate di un appartamento luminoso",
});
assert.deepEqual(rejected,[
  "EDITORIAL_CONCEPT_NOT_PROVEN",
  "EDITORIAL_SUBJECT_CROP_UNSAFE",
  "EDITORIAL_PROMPT_TOO_GENERIC",
]);
assert.deepEqual(creativeConceptIssues({
  placement:"EDITORIAL_SPLIT",
  visualIntent:"Il contrasto tra tariffa e costi di una gestione operativa",
  subject:"Un servizio reale dietro l'incasso illustrato senza cifre",
  composition:"Colonna destra con soggetto fra il 60% e il 95%; spazio tipografico sinistro",
  imagePrompt:"Fotografia editoriale narrativa che rende visibile il contrasto fra tariffa visibile e costi e lavoro operativo di preparazione. ".repeat(6),
}),[],"intent, visual mechanism, right crop and substantive prompt clear the gate");

let paidImagesAttempted = 0;
let cheapMediaCalls = 0;
const poorDirectorFetcher:typeof fetch = async (input,init) => {
  const url=String(input);
  if(url.endsWith("/responses")) {cheapMediaCalls++;return fetcher(input,init);}
  if(url.endsWith("/images/generations")) paidImagesAttempted++;
  throw Error("EXPENSIVE_IMAGE_PROVIDER_MUST_NOT_RUN");
};
await assert.rejects(
  ()=>generateOpenAIImage({
    apiKey:"sk-fake-not-real",profileName:"Il Tuo Property Manager",
    industry:"Affitti brevi",tone:"Professionale",provider:"FACEBOOK",format:"POST",
    visualBrief:"Titolo in grafica: «La tariffa non è il guadagno». Foto editoriale che dimostra il lavoro e costi operativi dietro l'incasso lordo.",
    typography:{brand:"Il Tuo Property Manager",headline:"La tariffa non è il guadagno",style:{layout:"EDITORIAL_SPLIT"}},
    fetcher:poorDirectorFetcher,
  }),/OPENAI_CREATIVE_CONCEPT_REJECTED/,
);
assert.equal(cheapMediaCalls,1);
assert.equal(paidImagesAttempted,0,"a weak creative director output cannot spend on Images 2");

console.log("PASS OpenAI image contract: Media Manager OpenAI precede esclusivamente GPT-Image-2.5 Sunburst; qualità high, formato PNG e metadati tracciati.");

{
  // Exact published rates when OpenAI splits input tokens; real Reel usage (14/11/2026): 1084 in / 1843 out.
  const exact = estimateImageCost({ inputTokens: 1084, outputTokens: 1843, textInputTokens: 1084, imageInputTokens: 0 });
  assert.equal(exact.basis, "OPENAI_USAGE_X_PUBLISHED_RATES");
  assert.ok(Math.abs(exact.costUsd - (1084 * 5 + 1843 * 30) / 1_000_000) < 1e-9);
  const prudent = estimateImageCost({ inputTokens: 1084, outputTokens: 1843 });
  assert.equal(prudent.basis, "CONSERVATIVE_ESTIMATE_UNSPLIT_INPUT");
  assert.ok(prudent.costUsd >= exact.costUsd, "the prudent estimate never under-counts");
  assert.ok(prudent.costUsd < 0.25, "the 0,25 $ per-image reserve covers the observed worst case");
  console.log(`PASS image pricing: esatto ${exact.costUsd} $, prudenziale ${prudent.costUsd} $ per immagine 1440x2560 high.`);
}
