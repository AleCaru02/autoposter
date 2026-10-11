declare module "fontkit" {
  export type Font = {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    layout(text: string): { advanceWidth: number };
  };
  export function create(data: Uint8Array): Font;
}

declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.woff" {
  const data: ArrayBuffer;
  export default data;
}
