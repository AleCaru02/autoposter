/**
 * Deterministic, safe logo overlay. A parsed and customer-approved base64 logo
 * is composited without asking the generative model to invent a logo.
 */
export function logoSvgOverlay(input:{logoDataUrl?:string|null;width:number;height:number;panelColor:string}) {
  const logo=typeof input.logoDataUrl==="string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.logoDataUrl) && input.logoDataUrl.length<=3_000_040
    ? input.logoDataUrl:null;
  if(!logo || !Number.isFinite(input.width)||!Number.isFinite(input.height)||input.width<64||input.height<64)return "";
  const logoWidth=Math.min(Math.round(input.width*0.18),240);
  const x=input.width-logoWidth-Math.max(28,Math.round(input.width*0.04));
  const y=Math.max(24,Math.round(input.height*0.035));
  const color=/^#[0-9a-fA-F]{6}$/.test(input.panelColor)?input.panelColor:"#FFFFFF";
  return `<rect x="${x-16}" y="${y-12}" width="${logoWidth+32}" height="112" rx="18" fill="${color}" fill-opacity="0.92"/><image href="${logo}" x="${x}" y="${y}" width="${logoWidth}" height="84" preserveAspectRatio="xMidYMid meet"/>`;
}
