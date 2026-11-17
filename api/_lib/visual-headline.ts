/**
 * A visual brief can require exact on-image wording. The generated caption hook
 * is often much longer and semantically different. Always honor an explicitly
 * quoted brief headline before composing typography or paying an image provider.
 * Never infer or invent new claims from an unquoted instruction.
 */
export function explicitGraphicHeadline(visualBrief: string | null | undefined): string | null {
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
  return null;
}

export function visualHeadlineForBrief(visualBrief: string | null | undefined, hook: string): string {
  return explicitGraphicHeadline(visualBrief) ?? hook.trim();
}

/**
 * A cheap deterministic barrier before image reservation/provider calls.
 * The editor must supply a distinct concise headline and a concrete visual
 * brief. Never spend to turn a paragraph into a giant unreadable card.
 */
export function assertAutopilotGraphicBrief(visualBrief: string | null | undefined): string {
  const headline = explicitGraphicHeadline(visualBrief);
  const summary = (visualBrief ?? "").trim();
  if (!headline || headline.length > 62 || headline.split(/\s+/).length > 12 || summary.length < 75) {
    throw new Error("AUTOPILOT_GRAPHIC_BRIEF_INCOMPLETE");
  }
  return headline;
}
