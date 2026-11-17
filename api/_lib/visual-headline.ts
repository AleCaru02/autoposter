/**
 * A visual brief can require exact on-image wording. The generated caption hook
 * is often much longer and semantically different. Always honor an explicitly
 * quoted brief headline before composing typography or paying an image provider.
 * Never infer or invent new claims from an unquoted instruction.
 */
export function visualHeadlineForBrief(visualBrief: string | null | undefined, hook: string): string {
  const brief = (visualBrief ?? "").normalize("NFKC");
  const labels = [
    /\bheadline\s*:\s*[“"«]([^”"»]{4,100})[”"»]/iu,
    /\b(?:sovraimpressione|titolo in grafica|testo in grafica)(?:\s+[a-zà-ù]+){0,3}\s*:\s*[“"«]([^”"»]{4,100})[”"»]/iu,
  ];
  for (const pattern of labels) {
    const match = pattern.exec(brief);
    if (match) {
      const exact = match[1].replace(/\s+/g, " ").trim();
      if (exact.length >= 4) return exact;
    }
  }
  return hook.trim();
}
