import { encodeJpeg } from "./vendor/jpeg-encoder.js";

/**
 * In-memory PNG -> JPEG transcode for Meta's image_url fetch.
 * No additional API, external image proxy or paid transformation service.
 * Only standard 8-bit, non-interlaced PNGs are accepted. Unsupported formats
 * fail closed rather than returning PNG with a JPEG MIME type.
 */
const PNG_SIGNATURE = [137,80,78,71,13,10,26,10];
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const MAX_JPEG_BYTES = 8 * 1024 * 1024;

function uint32(b: Uint8Array, p: number) {
  return ((b[p] * 0x1000000) + (b[p+1] << 16) + (b[p+2] << 8) + b[p+3]) >>> 0;
}
function paeth(a: number,b: number,c: number) {
  const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c);
  return da<=db&&da<=dc?a:db<=dc?b:c;
}

export function isActualJpeg(bytes: Uint8Array) {
  return bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff && bytes[bytes.length-2]===0xff && bytes[bytes.length-1]===0xd9;
}

export async function decodePngRgba(input: Uint8Array) {
  if(input.length<45||input.length>MAX_PNG_BYTES||PNG_SIGNATURE.some((v,i)=>input[i]!==v)) throw new Error("PNG_INVALID_SIGNATURE");
  let width=0,height=0,depth=0,color=0,interlace=0,seenIHDR=false,seenIEND=false;
  const chunks:Uint8Array[]=[];
  let compressedSize=0;
  let palette:Uint8Array|null=null;
  let alpha:Uint8Array|null=null;
  for(let p=8;p+12<=input.length;){
    const length=uint32(input,p);
    if(length>MAX_PNG_BYTES||p+12+length>input.length)throw new Error("PNG_INVALID_CHUNK");
    const type=String.fromCharCode(...input.subarray(p+4,p+8));
    const data=input.subarray(p+8,p+8+length);
    if(type==="IHDR"){
      if(seenIHDR||length!==13)throw new Error("PNG_INVALID_IHDR");
      width=uint32(data,0);height=uint32(data,4);depth=data[8];color=data[9];interlace=data[12];
      if(!width||!height||width*height>MAX_PIXELS||depth!==8||interlace!==0||data[10]!==0||data[11]!==0||![0,2,3,4,6].includes(color))throw new Error("PNG_UNSUPPORTED_FORMAT");
      seenIHDR=true;
    }else if(type==="PLTE"){palette=data.slice();}
    else if(type==="tRNS"){alpha=data.slice();}
    else if(type==="IDAT"){
      if(!seenIHDR)throw new Error("PNG_INVALID_ORDER");
      compressedSize+=data.length;
      if(compressedSize>MAX_PNG_BYTES)throw new Error("PNG_COMPRESSED_TOO_LARGE");
      chunks.push(data);
    }else if(type==="IEND"){seenIEND=true;break;}
    p+=length+12;
  }
  if(!seenIHDR||!seenIEND||!chunks.length)throw new Error("PNG_INCOMPLETE");
  const bpp=color===6?4:color===2?3:color===4?2:1;
  const stride=width*bpp;
  if((stride+1)*height>50*1024*1024)throw new Error("PNG_DECOMPRESSED_TOO_LARGE");
  const combined=new Uint8Array(compressedSize);
  for(let p=0,i=0;i<chunks.length;i++){combined.set(chunks[i],p);p+=chunks[i].length;}
  const stream=new Blob([combined]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw=new Uint8Array(await new Response(stream).arrayBuffer());
  if(raw.length!==(stride+1)*height)throw new Error("PNG_DECOMPRESSED_LENGTH_INVALID");
  const pixels=new Uint8Array(stride*height);
  let pos=0;
  for(let y=0;y<height;y++){
    const filter=raw[pos++];if(filter>4)throw new Error("PNG_FILTER_INVALID");
    const offset=y*stride;
    for(let x=0;x<stride;x++){
      const value=raw[pos++];
      const left=x>=bpp?pixels[offset+x-bpp]:0;
      const above=y?pixels[offset+x-stride]:0;
      const upperLeft=y&&x>=bpp?pixels[offset+x-stride-bpp]:0;
      const predictor=filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):filter===4?paeth(left,above,upperLeft):0;
      pixels[offset+x]=(value+predictor)&255;
    }
  }
  const rgba=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++){
    const j=i*bpp,k=i*4;
    let r=0,g=0,b=0,a=255;
    if(color===6){r=pixels[j];g=pixels[j+1];b=pixels[j+2];a=pixels[j+3];}
    if(color===2){r=pixels[j];g=pixels[j+1];b=pixels[j+2];}
    if(color===0){r=g=b=pixels[j];}
    if(color===4){r=g=b=pixels[j];a=pixels[j+1];}
    if(color===3){
      const idx=pixels[j];if(!palette||idx*3+2>=palette.length)throw new Error("PNG_PALETTE_INVALID");
      r=palette[idx*3];g=palette[idx*3+1];b=palette[idx*3+2];a=alpha?.[idx]??255;
    }
    // Flatten transparencies onto the product's warm-neutral canvas.
    const opacity=a/255;
    rgba[k]=Math.round(r*opacity+255*(1-opacity));
    rgba[k+1]=Math.round(g*opacity+253*(1-opacity));
    rgba[k+2]=Math.round(b*opacity+248*(1-opacity));
    rgba[k+3]=255;
  }
  return {width,height,data:rgba};
}

export async function toInstagramJpeg(bytes: Uint8Array, mime: string) {
  const type=mime.split(";")[0].trim().toLowerCase();
  if(type==="image/jpeg"){
    if(!isActualJpeg(bytes)||bytes.length>MAX_JPEG_BYTES)throw new Error("INSTAGRAM_JPEG_INVALID");
    return bytes;
  }
  if(type!=="image/png")throw new Error("INSTAGRAM_IMAGE_UNSUPPORTED_MIME");
  const image=await decodePngRgba(bytes);
  const encoded=encodeJpeg(image, 86) as {data:Uint8Array};
  const jpeg=new Uint8Array(encoded.data);
  if(!isActualJpeg(jpeg)||jpeg.length>MAX_JPEG_BYTES)throw new Error("INSTAGRAM_JPEG_ENCODING_FAILED");
  return jpeg;
}
