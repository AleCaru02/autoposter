import { createAuthClient } from "better-auth/react";

export const NEON_AUTH_URL =
  "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";

export const authClient = createAuthClient({
  baseURL: NEON_AUTH_URL,
  sessionOptions: {
    refetchOnWindowFocus: true,
    refetchWhenOffline: false,
  },
});
