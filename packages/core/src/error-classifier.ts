export type PublicationErrorClass =
  | 'retryable'
  | 'non_retryable'
  | 'auth'
  | 'rate_limit'
  | 'validation'
  | 'platform_rejection';

export interface PublicationErrorInput {
  httpStatus?: number;
  providerCode?: string;
  networkError?: boolean;
  timeout?: boolean;
  explicitPlatformRejection?: boolean;
  retryAfterSeconds?: number;
}

export interface PublicationErrorDecision {
  classification: PublicationErrorClass;
  retry: boolean;
  honorRetryAfter: boolean;
}

export function classifyPublicationError(input: PublicationErrorInput): PublicationErrorDecision {
  if (input.networkError || input.timeout) {
    return { classification: 'retryable', retry: true, honorRetryAfter: false };
  }

  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return { classification: 'auth', retry: false, honorRetryAfter: false };
  }

  if (input.httpStatus === 429) {
    return { classification: 'rate_limit', retry: true, honorRetryAfter: input.retryAfterSeconds !== undefined };
  }

  if (input.explicitPlatformRejection) {
    return { classification: 'platform_rejection', retry: false, honorRetryAfter: false };
  }

  if (input.httpStatus !== undefined && input.httpStatus >= 500) {
    return { classification: 'retryable', retry: true, honorRetryAfter: false };
  }

  if (input.httpStatus !== undefined && input.httpStatus >= 400) {
    return { classification: 'validation', retry: false, honorRetryAfter: false };
  }

  return { classification: 'non_retryable', retry: false, honorRetryAfter: false };
}
