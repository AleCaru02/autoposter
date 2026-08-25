import { describe, expect, it } from 'vitest';
import { classifyPublicationError } from '../src/error-classifier.js';

describe('publication error classifier', () => {
  it('does not retry auth errors', () => {
    expect(classifyPublicationError({ httpStatus: 401 })).toEqual({
      classification: 'auth', retry: false, honorRetryAfter: false,
    });
  });

  it('retries rate limits and honors Retry-After', () => {
    expect(classifyPublicationError({ httpStatus: 429, retryAfterSeconds: 60 })).toEqual({
      classification: 'rate_limit', retry: true, honorRetryAfter: true,
    });
  });

  it('retries transient 5xx errors', () => {
    expect(classifyPublicationError({ httpStatus: 503 }).retry).toBe(true);
  });

  it('does not blindly retry validation errors', () => {
    expect(classifyPublicationError({ httpStatus: 400 }).retry).toBe(false);
  });
});
