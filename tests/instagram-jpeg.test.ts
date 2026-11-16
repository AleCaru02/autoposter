import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { decodePngRgba, isActualJpeg, toInstagramJpeg } from "../api/_lib/instagram-jpeg.js";

function u32(x: number) { const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,x,false);return b; }
function join(...pieces:Uint8Array[]) {const n=pieces.reduce((a,b)=>a+b.length,0);const out=new Uint8Array(n);let p=0;for(const piece of pieces){out.set(piece,p);p+=piece.length;}return out;}
function chunk(type:string,data:Uint8Array) {return join(u32(data.length),new TextEncoder().encode(type),data,u32(0));}
function png(width:number,height:number,color=6) {
  const ihdr=join(u32(width),u32(height),new Uint8Array([8,color,0,0,0]));
  const raw=new Uint8Array(height*(width*4+1));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*(width*4+1)+1+x*4;
    raw[p]=255;raw[p+1]=x?100:0;raw[p+2]=y?90:0;raw[p+3]=255;
  }
  return join(new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ihdr),chunk("IDAT",new Uint8Array(deflateSync(raw))),chunk("IEND",new Uint8Array()));
}
const sample=png(2,2);
const decoded=await decodePngRgba(sample);
assert.equal(decoded.width,2);
assert.equal(decoded.height,2);
assert.deepEqual([...decoded.data.slice(0,4)],[255,0,0,255]);
const jpeg=await toInstagramJpeg(sample,"image/png");
assert.equal(isActualJpeg(jpeg),true);
assert.equal(jpeg[0],255);
assert.equal(jpeg[1],216);
assert.ok(jpeg.length>100);
assert.deepEqual(await toInstagramJpeg(jpeg,"image/jpeg"),jpeg);
await assert.rejects(()=>toInstagramJpeg(sample,"image/webp"),/UNSUPPORTED_MIME/);
await assert.rejects(()=>decodePngRgba(new Uint8Array([1,2,3])),/SIGNATURE/);
await assert.rejects(()=>decodePngRgba(png(2,2,3)),/DECOMPRESSED_LENGTH_INVALID|PALETTE_INVALID/);
console.log("PNG-to-JPEG: PASS — decoded RGBA, transcoded JPEG, restricted formats and signature checks.");
