import fs from "node:fs";

const apiKey=(process.env.OPENAI_API_KEY||"").trim();
if(!apiKey) throw new Error("OPENAI_API_KEY_MISSING");

const prompt = [
  "Create a premium square social media creative for an Italian property management business.",
  "Theme: CityLife/Fiera oltre il calendario eventi.",
  "Art direction: photographic/editorial premium, modern Milan atmosphere, contemporary architecture, refined urban residential/business district, elegant short-term-rental hospitality mood, clean composition, sophisticated but not ostentatious.",
  "Scene: a believable editorial composite that combines contemporary glass-and-steel urban architecture with a subtle sense of a comfortable, well-managed apartment stay. It must communicate strategic area + carefully chosen accommodation visually.",
  "Important: do NOT depict an exact map, metro line, route, pin, distance, transit diagram, street layout, geographic infographic, or any pseudo-precise geographic data. Do NOT imitate an official CityLife map. Do NOT claim a specific building is a real listing.",
  "Avoid generic stock-photo look, cheap corporate vector graphics, flat SVG style, infographic boxes, tables, icons, fake statistics, logos, watermarks, or brochure clutter.",
  "Palette: deep navy, elegant light grey, white, muted dusty blue accents.",
  "Composition: strong photographic/editorial focal point on the right or lower-right; generous negative space on the left/upper-left for minimal typography.",
  "Typography inside image: only two short lines, rendered accurately in Italian: 'CityLife/Fiera' and below 'oltre il calendario eventi'. Small discreet brand name 'Il Tuo Property Manager' may appear once. No subtitle, no CTA, no disclaimer.",
  "High-end real-estate social campaign quality, natural light, realistic materials, depth, cinematic but credible, polished Facebook static post.",
  "The result should feel like a professional advertising creative, not a literal documentary photograph or factual geographic proof."
].join("\n");

const response=await fetch("https://api.openai.com/v1/images/generations",{
  method:"POST",
  headers:{
    authorization:`Bearer ${apiKey}`,
    "content-type":"application/json"
  },
  body:JSON.stringify({
    model:"gpt-image-2",
    prompt,
    size:"1024x1024",
    quality:"high",
    n:1,
    output_format:"png"
  })
});
const raw=await response.text();
if(!response.ok){
  let parsed={};
  try{parsed=JSON.parse(raw)}catch{}
  const code=parsed?.error?.code||parsed?.error?.type||"UNKNOWN";
  const message=String(parsed?.error?.message||"").slice(0,500);
  console.error("PAID_VISUAL_OPENAI_FAIL",JSON.stringify({status:response.status,code,message}));
  process.exit(2);
}
const body=JSON.parse(raw);
const b64=body?.data?.[0]?.b64_json||body?.data?.[0]?.b64;
if(!b64) throw new Error("OPENAI_IMAGE_EMPTY_OUTPUT");
const out="paid-visual-output";
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(`${out}/citylife_paid_visual.png`,Buffer.from(b64,"base64"));
const usage=body?.usage||{};
fs.writeFileSync(`${out}/metadata.json`,JSON.stringify({
  provider:"OPENAI",
  model:"gpt-image-2",
  size:"1024x1024",
  quality:"high",
  output_format:"png",
  request_id:response.headers.get("x-request-id")||null,
  usage:{
    input_tokens:usage.input_tokens??null,
    output_tokens:usage.output_tokens??null,
    total_tokens:usage.total_tokens??null
  }
},null,2));
console.log("PAID_VISUAL_OPENAI_PASS",JSON.stringify({
  model:"gpt-image-2",
  size:"1024x1024",
  quality:"high",
  bytes:fs.statSync(`${out}/citylife_paid_visual.png`).size,
  requestId:response.headers.get("x-request-id")||null
}));
