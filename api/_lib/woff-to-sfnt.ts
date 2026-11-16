/**
 * WOFF 1.0 -> SFNT (TrueType/OpenType) conversion.
 * resvg-wasm only rasterises raw SFNT font data: WOFF buffers are silently ignored and text
 * renders as nothing. Runtime-neutral (DecompressionStream exists in Node >= 18 and Workers).
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u32(view: DataView, offset: number) { return view.getUint32(offset); }

export function isWoff(bytes: Uint8Array) {
  return bytes.length > 44 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46; // "wOFF"
}

export async function woffToSfnt(input: Uint8Array): Promise<Uint8Array> {
  if (!isWoff(input)) return input;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const flavor = u32(view, 4);
  const numTables = view.getUint16(12);
  if (!numTables || numTables > 200) throw new Error("WOFF_TABLES_INVALID");
  const tables: Array<{ tag: number; checksum: number; data: Uint8Array }> = [];
  for (let index = 0; index < numTables; index += 1) {
    const entry = 44 + index * 20;
    const tag = u32(view, entry);
    const offset = u32(view, entry + 4);
    const compLength = u32(view, entry + 8);
    const origLength = u32(view, entry + 12);
    const checksum = u32(view, entry + 16);
    if (offset + compLength > input.byteLength) throw new Error("WOFF_TABLE_OUT_OF_RANGE");
    const raw = input.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflate(raw) : raw.slice();
    if (data.byteLength !== origLength) throw new Error("WOFF_TABLE_LENGTH_MISMATCH");
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => a.tag - b.tag);
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = 2 ** entrySelector * 16;
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((size, table) => size + Math.ceil(table.data.byteLength / 4) * 4, headerSize);
  const output = new Uint8Array(total);
  const out = new DataView(output.buffer);
  out.setUint32(0, flavor);
  out.setUint16(4, numTables);
  out.setUint16(6, searchRange);
  out.setUint16(8, entrySelector);
  out.setUint16(10, numTables * 16 - searchRange);
  let cursor = headerSize;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    out.setUint32(record, table.tag);
    out.setUint32(record + 4, table.checksum);
    out.setUint32(record + 8, cursor);
    out.setUint32(record + 12, table.data.byteLength);
    output.set(table.data, cursor);
    cursor += Math.ceil(table.data.byteLength / 4) * 4;
  });
  return output;
}
