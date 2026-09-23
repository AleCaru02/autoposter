export type WebsiteScanSnapshot = {
  state?: string | null;
  error?: string | null;
  discovered_pages?: number | null;
  analyzed_pages?: number | null;
  skipped_pages?: number | null;
  failed_pages?: number | null;
};

export type WebsiteScanUiState =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "COMPLETED_WITH_WARNINGS"
  | "FAILED"
  | "IDLE";

const ACTIVE_STATES = new Set(["PENDING", "RUNNING", "PARTIAL", "BATCH_PENDING"]);
const COMPLETE_STATES = new Set(["COMPLETE", "COMPLETED", "SUCCESS"]);
const WARNING_STATES = new Set(["COMPLETE_WITH_WARNINGS", "COMPLETED_WITH_WARNINGS"]);
const FAILED_STATES = new Set(["FAILED", "ERROR", "TIMEOUT"]);

function upper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function websiteScanUiState(scan: WebsiteScanSnapshot | null | undefined): WebsiteScanUiState {
  if (!scan) return "IDLE";
  const state = upper(scan.state);
  const error = upper(scan.error);

  if (WARNING_STATES.has(state)) return "COMPLETED_WITH_WARNINGS";
  if (COMPLETE_STATES.has(state)) return (scan.failed_pages ?? 0) > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
  if (FAILED_STATES.has(state)) return "FAILED";

  if (ACTIVE_STATES.has(state)) {
    if (!error || error === "BATCH_PENDING") return "IN_PROGRESS";
    if (error === "PAGE_ERRORS" && (scan.discovered_pages ?? 0) > 0) return "COMPLETED_WITH_WARNINGS";
    return "FAILED";
  }

  if (error === "BATCH_PENDING") return "IN_PROGRESS";
  if (error) return "FAILED";
  return "IDLE";
}

export function websiteScanProgress(scan: WebsiteScanSnapshot | null | undefined) {
  const discovered = Math.max(0, Number(scan?.discovered_pages ?? 0));
  const analyzed = Math.max(0, Number(scan?.analyzed_pages ?? 0));
  const skipped = Math.max(0, Number(scan?.skipped_pages ?? 0));
  const failed = Math.max(0, Number(scan?.failed_pages ?? 0));
  const processed = Math.min(discovered || Number.MAX_SAFE_INTEGER, analyzed + skipped + failed);
  const percent = discovered > 0 ? Math.min(100, Math.max(0, Math.round((processed / discovered) * 100))) : 0;
  return {
    discovered,
    analyzed,
    skipped,
    failed,
    processed: discovered > 0 ? processed : analyzed + skipped + failed,
    remaining: discovered > 0 ? Math.max(discovered - processed, 0) : 0,
    percent,
  };
}

export function isWebsiteScanInProgress(scan: WebsiteScanSnapshot | null | undefined) {
  return websiteScanUiState(scan) === "IN_PROGRESS";
}

export function isWebsiteScanTerminal(scan: WebsiteScanSnapshot | null | undefined) {
  const state = websiteScanUiState(scan);
  return state === "COMPLETED" || state === "COMPLETED_WITH_WARNINGS" || state === "FAILED";
}
