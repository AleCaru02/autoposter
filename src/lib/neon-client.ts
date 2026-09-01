import { createClient } from "@neondatabase/neon-js";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

export const SAME_ORIGIN_AUTH_PATH = "/api/auth";
const DEFAULT_APP_ORIGIN = "https://autoposter.02alessandrocaruso.workers.dev";
const browserOrigin = typeof window === "undefined" ? DEFAULT_APP_ORIGIN : window.location.origin;

export const NEON_AUTH_URL = `${browserOrigin}${SAME_ORIGIN_AUTH_PATH}`;
export const NEON_DATA_API_URL =
  "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

export const neonClient = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: NEON_AUTH_URL,
  },
  dataApi: {
    url: NEON_DATA_API_URL,
  },
});

export const authClient = neonClient.auth;
