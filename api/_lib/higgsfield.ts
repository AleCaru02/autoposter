const HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";

export type HiggsfieldCredentials = { keyId: string; keySecret: string };
export type HiggsfieldSoulStatus = "not_ready" | "queued" | "in_progress" | "completed" | "failed";

export type HiggsfieldSoulId = {
  id: string;
  name: string;
  created_at?: string | null;
  status: HiggsfieldSoulStatus | string;
  thumbnail_url?: string | null;
  in_progress_at?: string | null;
  reference_media?: Array<{ id?: string; media_url?: string }>;
};

export function parseHiggsfieldCredentials(value?: string | null): HiggsfieldCredentials | null {
  const raw = value?.trim();
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator === raw.length - 1) return null;
  const keyId = raw.slice(0, separator).trim();
  const keySecret = raw.slice(separator + 1).trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function higgsfieldConfigured(value?: string | null) {
  return parseHiggsfieldCredentials(value) !== null;
}

function headers(credentials: HiggsfieldCredentials, json = false) {
  const value: Record<string, string> = {
    "hf-api-key": credentials.keyId,
    "hf-secret": credentials.keySecret,
  };
  if (json) value["content-type"] = "application/json";
  return value;
}

async function responseJson<T>(response: Response, errorCode: string): Promise<T> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${errorCode}_HTTP_${response.status}`);
  try { return JSON.parse(body) as T; }
  catch { throw new Error(`${errorCode}_INVALID_RESPONSE`); }
}

export async function createHiggsfieldSoulId(input: {
  credentials: HiggsfieldCredentials;
  name: string;
  imageUrls: string[];
  fetcher?: typeof fetch;
}): Promise<HiggsfieldSoulId> {
  const name = input.name.trim().slice(0, 100);
  const imageUrls = [...new Set(input.imageUrls.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  if (!name) throw new Error("HIGGSFIELD_SOUL_NAME_REQUIRED");
  if (!imageUrls.length) throw new Error("HIGGSFIELD_SOUL_IMAGES_REQUIRED");
  for (const value of imageUrls) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HIGGSFIELD_SOUL_IMAGE_URL_INVALID");
  }

  const response = await (input.fetcher ?? fetch)(`${HIGGSFIELD_BASE_URL}/v1/custom-references`, {
    method: "POST",
    headers: headers(input.credentials, true),
    body: JSON.stringify({
      name,
      input_images: imageUrls.map((image_url) => ({ type: "image_url", image_url })),
    }),
  });
  return responseJson<HiggsfieldSoulId>(response, "HIGGSFIELD_SOUL_CREATE");
}

export async function getHiggsfieldSoulId(input: {
  credentials: HiggsfieldCredentials;
  referenceId: string;
  fetcher?: typeof fetch;
}): Promise<HiggsfieldSoulId> {
  if (!/^[0-9a-f-]{36}$/i.test(input.referenceId)) throw new Error("HIGGSFIELD_SOUL_ID_INVALID");
  const response = await (input.fetcher ?? fetch)(
    `${HIGGSFIELD_BASE_URL}/v1/custom-references/${encodeURIComponent(input.referenceId)}`,
    { headers: headers(input.credentials) },
  );
  return responseJson<HiggsfieldSoulId>(response, "HIGGSFIELD_SOUL_STATUS");
}

export function normalizeHiggsfieldSoulState(status: string) {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "COMPLETED" as const;
  if (value === "failed") return "FAILED" as const;
  if (value === "queued" || value === "in_progress" || value === "not_ready") return "CREATING" as const;
  return "FAILED" as const;
}
