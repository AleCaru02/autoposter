import type { HTTPTransactionOptions, NeonQueryFunction } from "@neondatabase/serverless";

declare module "@neondatabase/serverless" {
  export function neon(
    connectionString: string,
    options?: HTTPTransactionOptions<false, false> & {
      authToken?: string | (() => Promise<string> | string);
    },
  ): NeonQueryFunction<false, false>;
}

export {};
