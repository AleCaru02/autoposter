/**
 * Consent text shown in the app and hashed server-side at grant time. Changing the wording
 * requires a new version: existing consents keep the hash of the text actually accepted.
 */
export const IDENTITY_CONSENT_VERSION = "it-2026-11-v2";

export function identityConsentText(subjectName: string, scopes: Array<"FACE" | "VOICE">) {
  const what = scopes.includes("FACE") && scopes.includes("VOICE") ? "del mio volto e della mia voce" : scopes.includes("FACE") ? "del mio volto" : "della mia voce";
  return [
    `Io, ${subjectName.trim()}, sono la persona ritratta e registrata nei materiali che carico e autorizzo l'uso ${what}`,
    "per creare un avatar digitale destinato esclusivamente ai contenuti del mio personal brand in questa applicazione.",
    "I materiali restano in uno spazio privato, sono visibili solo tramite link temporanei e vengono conservati per 12 mesi salvo eliminazione anticipata.",
    "Nessun contenuto con l'avatar viene pubblicato senza la mia approvazione. Posso revocare questo consenso in qualsiasi momento:",
    "la revoca blocca subito nuove generazioni e mi permette di eliminare tutti i materiali.",
  ].join(" ");
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
