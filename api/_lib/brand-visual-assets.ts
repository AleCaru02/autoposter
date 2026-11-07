import type { TypographyStyle } from "./deterministic-text-compositor.js";

function obj(v: unknown): Record<string,unknown> {return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}
export function confirmedBrandLogoId(visualIdentity: unknown) {
  const b=obj(visualIdentity);
  if(b.brandKitApproved!==true || typeof b.logoAssetId!=="string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(b.logoAssetId))return null;
  return b.logoAssetId;
}

/** Only a customer-approved asset inside their profile; no arbitrary external image fetching. */
export function verifiedBrandLogoDataUrl(row: {storage_url?: string|null;mime_type?:string|null}|null|undefined) {
  if(!row?.storage_url)return null;
  const mime=row.mime_type?.toLowerCase().split(";")[0].trim();
  if(mime!=="image/png"&&mime!=="image/jpeg")return null;
  const match=/^data:image\/(png|jpeg);base64,([a-z0-9+/]+={0,2})$/i.exec(row.storage_url);
  if(!match || `image/${match[1].toLowerCase()}`!==mime || match[2].length>3_000_000 || match[2].length<24)return null;
  return row.storage_url;
}

function luminance(hex:string) {
  if(!/^#[a-f0-9]{6}$/i.test(hex))return null;
  const parts=[1,3,5].map(p=>parseInt(hex.slice(p,p+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return parts[0]*0.2126+parts[1]*0.7152+parts[2]*0.0722;
}
function contrast(a:string,b:string) {
  const x=luminance(a),y=luminance(b);
  if(x==null||y==null)return 0;
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
export function brandTextStyle(palette:{primary:string;secondary:string;accent:string;neutral:string}):TypographyStyle {
  const panel=/^#[0-9a-f]{6}$/i.test(palette.neutral)?palette.neutral:"#FFFDF8";
  const bright=(luminance(panel)??1)>0.45;
  const base=bright?"#172430":"#FFFFFF";
  const brand=[palette.primary,palette.secondary,palette.accent].find(c=>contrast(c,panel)>=4.5)??base;
  return {panelColor:panel,textColor:base,brandColor:brand,panelOpacity:0.95};
}
