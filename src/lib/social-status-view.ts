export type SocialProviderSnapshot = {
  provider: string;
  configured: boolean;
  status: string;
  expiresAt?: string | null;
};

export type SocialProviderUiState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "ACTIVE"
  | "RECONNECT"
  | "ERROR"
  | "UNAVAILABLE";

const CONNECTING = new Set(["PENDING", "CONNECTING", "PENDING_SELECTION", "OAUTH_PENDING"]);
const DISCONNECTED = new Set(["", "NOT_CONNECTED", "DISCONNECTED"]);
const RECONNECT = new Set(["RECONNECT_REQUIRED", "TOKEN_EXPIRED", "EXPIRED", "TOKEN_INVALID"]);
const ERROR = new Set(["ERROR", "FAILED", "PROVIDER_ERROR"]);

export function socialProviderUiState(provider: SocialProviderSnapshot, now = Date.now()): SocialProviderUiState {
  const status = (provider.status || "").trim().toUpperCase();

  if (RECONNECT.has(status) || status.includes("RECONNECT_REQUIRED") || status.endsWith("_EXPIRED")) return "RECONNECT";
  if (ERROR.has(status) || status.endsWith("_ERROR") || status.endsWith("_FAILED")) return "ERROR";

  if (status === "ACTIVE") {
    if (!provider.configured) return "UNAVAILABLE";
    if (provider.provider !== "GBP" && provider.expiresAt) {
      const expiresAt = Date.parse(provider.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) return "RECONNECT";
    }
    return "ACTIVE";
  }

  if (CONNECTING.has(status)) return provider.configured ? "CONNECTING" : "UNAVAILABLE";
  if (!provider.configured) return "UNAVAILABLE";
  if (DISCONNECTED.has(status)) return "DISCONNECTED";
  return "ERROR";
}

export function socialProviderUiLabel(state: SocialProviderUiState) {
  if (state === "ACTIVE") return "Collegato";
  if (state === "CONNECTING") return "Connessione in corso";
  if (state === "RECONNECT") return "Ricollega";
  if (state === "ERROR") return "Errore";
  if (state === "UNAVAILABLE") return "Da configurare";
  return "Non collegato";
}
