const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
export const MIN_REFERENCE_COUNT = 3;
export const MAX_REFERENCE_COUNT = 12;

export type ReferenceTechnicalQuality = {
  status: "PASS" | "REJECTED";
  score: number;
  reasons: string[];
  width: number | null;
  height: number | null;
};

function u24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function imageDimensions(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png" && bytes.length >= 24
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (mimeType === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += length;
    }
  }

  if (mimeType === "image/webp" && bytes.length >= 30
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    }
    if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
        height: ((bytes[29] << 8) | bytes[28]) & 0x3fff,
      };
    }
  }
  return { width: null, height: null };
}

export function evaluateReferenceImage(bytes: Uint8Array, mimeType: string): ReferenceTechnicalQuality {
  const supported = ["image/jpeg","image/png","image/webp"].includes(mimeType);
  const reasons: string[] = [];
  if (!supported) return { status: "REJECTED", score: 0, reasons: ["UNSUPPORTED_MIME_TYPE"], width: null, height: null };
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) return { status: "REJECTED", score: 0, reasons: ["INVALID_FILE_SIZE"], width: null, height: null };

  const { width, height } = imageDimensions(bytes, mimeType);
  if (!width || !height) return { status: "REJECTED", score: 0.2, reasons: ["DIMENSIONS_NOT_VERIFIABLE"], width: null, height: null };
  if (width > 12000 || height > 12000) reasons.push("DIMENSIONS_TOO_LARGE");
  if (Math.min(width, height) < 512) reasons.push("RESOLUTION_TOO_LOW");
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (ratio > 4) reasons.push("EXTREME_ASPECT_RATIO");

  const pixels = width * height;
  let score = Math.min(1, 0.55 + Math.log10(Math.max(pixels, 1) / 262144) * 0.18);
  if (bytes.length < 35_000) { score -= 0.15; reasons.push("VERY_SMALL_FILE"); }
  score = Math.max(0, Math.min(1, score));
  const blocking = reasons.some((reason) => ["DIMENSIONS_TOO_LARGE","RESOLUTION_TOO_LOW","EXTREME_ASPECT_RATIO"].includes(reason));
  return {
    status: blocking ? "REJECTED" : "PASS",
    score: Math.round(score * 1000) / 1000,
    reasons: blocking ? reasons : [...reasons, "TECHNICAL_REFERENCE_PASS"],
    width,
    height,
  };
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function signReferencePath(secret: string, referenceId: string, expiresAtSeconds: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${referenceId}:${expiresAtSeconds}`)));
}

export async function referenceFingerprint(hashes: string[]) {
  return sha256Hex(new TextEncoder().encode([...hashes].sort().join("|")));
}
