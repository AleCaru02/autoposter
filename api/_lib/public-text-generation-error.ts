/** Public, stable errors. Never expose provider or database diagnostics to clients. */
export function publicTextGenerationError(detail: string) {
  if (detail === "OPENAI_FACTCHECK_NEEDS_SOURCE") return "FACTCHECK_NEEDS_SOURCE";
  if (detail === "OPENAI_FACTCHECK_BLOCK") return "FACTCHECK_BLOCKED";
  if (detail === "OPENAI_RESEARCH_BLOCKED" || detail === "AI_BRAIN_INSUFFICIENT_SOURCES") return "RESEARCH_INSUFFICIENT";
  if (detail.startsWith("METERING_FAILED")) return "METERING_FAILED";
  if (detail.startsWith("OPENAI_")) return "AI_PROVIDER_ERROR";
  return "GENERATION_FAILED";
}
