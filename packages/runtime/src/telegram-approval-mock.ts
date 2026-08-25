export type ApprovalAction = 'approve' | 'reject';

export interface TelegramApprovalRequest {
  id: string;
  tenantId: string;
  postId: string;
  telegramUserId: string;
  nonce: string;
  signature: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface TelegramApprovalResult {
  tenantId: string;
  postId: string;
  action: ApprovalAction;
  approvedByTelegramUserId: string;
  consumedAt: string;
}

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const signPayload = async (secret: string, payload: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

export class TelegramApprovalMock {
  private readonly requests = new Map<string, TelegramApprovalRequest>();
  private sequence = 0;

  constructor(private readonly signingSecret: string) {
    if (signingSecret.length < 16) throw new Error('telegram_mock_secret_too_short');
  }

  async createRequest(input: {
    tenantId: string;
    postId: string;
    telegramUserId: string;
    now: string;
    ttlSeconds?: number;
  }): Promise<TelegramApprovalRequest> {
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) throw new Error('telegram_mock_invalid_now');
    const ttlSeconds = input.ttlSeconds ?? 900;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86_400) {
      throw new Error('telegram_mock_invalid_ttl');
    }

    this.sequence += 1;
    const id = `tg-approval-${this.sequence}`;
    const nonce = `${id}-${crypto.randomUUID()}`;
    const expiresAt = new Date(nowMs + ttlSeconds * 1_000).toISOString();
    const signature = await signPayload(
      this.signingSecret,
      this.payload({ id, tenantId: input.tenantId, postId: input.postId, telegramUserId: input.telegramUserId, nonce, expiresAt }),
    );

    const request: TelegramApprovalRequest = {
      id,
      tenantId: input.tenantId,
      postId: input.postId,
      telegramUserId: input.telegramUserId,
      nonce,
      signature,
      expiresAt,
    };
    this.requests.set(id, request);
    return { ...request };
  }

  async consumeCallback(input: {
    requestId: string;
    tenantId: string;
    telegramUserId: string;
    nonce: string;
    signature: string;
    action: ApprovalAction;
    now: string;
  }): Promise<TelegramApprovalResult> {
    const request = this.requests.get(input.requestId);
    if (!request) throw new Error('telegram_mock_request_not_found');
    if (request.consumedAt) throw new Error('telegram_mock_nonce_already_consumed');
    if (request.tenantId !== input.tenantId) throw new Error('telegram_mock_tenant_mismatch');
    if (request.telegramUserId !== input.telegramUserId) throw new Error('telegram_mock_user_mismatch');
    if (request.nonce !== input.nonce) throw new Error('telegram_mock_nonce_mismatch');

    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) throw new Error('telegram_mock_invalid_now');
    if (nowMs > Date.parse(request.expiresAt)) throw new Error('telegram_mock_request_expired');

    const expected = await signPayload(
      this.signingSecret,
      this.payload(request),
    );
    if (!constantTimeEqual(expected, input.signature) || !constantTimeEqual(request.signature, input.signature)) {
      throw new Error('telegram_mock_invalid_signature');
    }

    request.consumedAt = new Date(nowMs).toISOString();
    return {
      tenantId: request.tenantId,
      postId: request.postId,
      action: input.action,
      approvedByTelegramUserId: request.telegramUserId,
      consumedAt: request.consumedAt,
    };
  }

  private payload(input: {
    id: string;
    tenantId: string;
    postId: string;
    telegramUserId: string;
    nonce: string;
    expiresAt: string;
  }): string {
    return [input.id, input.tenantId, input.postId, input.telegramUserId, input.nonce, input.expiresAt].join('|');
  }
}
