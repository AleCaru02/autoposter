import { describe, expect, it } from 'vitest';
import {
  InMemoryTenantSupportResolver,
  SupportAssistantMock,
  type TenantSupportResolver,
} from '../src/support-assistant-mock.js';
import { TelegramApprovalMock } from '../src/telegram-approval-mock.js';

const articles = [
  {
    id: 'public-plans',
    title: 'Piani e quote',
    content: 'I piani definiscono limiti e funzionalità disponibili.',
    category: 'billing',
    isPublic: true,
  },
  {
    id: 'internal-ops',
    title: 'Operazioni interne',
    content: 'Contenuto interno non destinato al chatbot pubblico.',
    category: 'internal',
    isPublic: false,
  },
];

describe('SupportAssistantMock', () => {
  it('keeps the public chatbot isolated from tenant resolvers and private articles', async () => {
    let tenantCalls = 0;
    const resolver: TenantSupportResolver = {
      async resolve() {
        tenantCalls += 1;
        return [{ key: 'secret', value: 'tenant-only' }];
      },
    };
    const assistant = new SupportAssistantMock(articles, resolver);
    const answer = await assistant.answerPublic('Come funzionano i piani e i limiti?');

    expect(answer.scope).toBe('public');
    expect(answer.sourceArticleIds).toContain('public-plans');
    expect(answer.sourceArticleIds).not.toContain('internal-ops');
    expect(answer.tenantFactKeys).toEqual([]);
    expect(tenantCalls).toBe(0);
  });

  it('resolves tenant facts strictly from the requested tenant', async () => {
    const resolver = new InMemoryTenantSupportResolver({
      'tenant-a': [{ key: 'quota post', value: '3 a settimana' }],
      'tenant-b': [{ key: 'quota post', value: '7 a settimana' }],
    });
    const assistant = new SupportAssistantMock(articles, resolver);

    const a = await assistant.answerTenant({ tenantId: 'tenant-a', question: 'Qual è la quota post?' });
    const b = await assistant.answerTenant({ tenantId: 'tenant-b', question: 'Qual è la quota post?' });
    expect(a.answer).toContain('3 a settimana');
    expect(a.answer).not.toContain('7 a settimana');
    expect(b.answer).toContain('7 a settimana');
    expect(b.answer).not.toContain('3 a settimana');
  });
});

describe('TelegramApprovalMock', () => {
  it('validates tenant, user, signature, expiration and one-time nonce consumption', async () => {
    const approvals = new TelegramApprovalMock('local-test-signing-secret-123456');
    const request = await approvals.createRequest({
      tenantId: 'tenant-a',
      postId: 'post-1',
      telegramUserId: 'tg-user-a',
      now: '2026-08-09T12:00:00.000Z',
      ttlSeconds: 300,
    });

    await expect(
      approvals.consumeCallback({
        requestId: request.id,
        tenantId: 'tenant-b',
        telegramUserId: 'tg-user-a',
        nonce: request.nonce,
        signature: request.signature,
        action: 'approve',
        now: '2026-08-09T12:01:00.000Z',
      }),
    ).rejects.toThrow('telegram_mock_tenant_mismatch');

    await expect(
      approvals.consumeCallback({
        requestId: request.id,
        tenantId: 'tenant-a',
        telegramUserId: 'tg-user-a',
        nonce: request.nonce,
        signature: `${request.signature.slice(0, -1)}0`,
        action: 'approve',
        now: '2026-08-09T12:01:00.000Z',
      }),
    ).rejects.toThrow('telegram_mock_invalid_signature');

    const result = await approvals.consumeCallback({
      requestId: request.id,
      tenantId: 'tenant-a',
      telegramUserId: 'tg-user-a',
      nonce: request.nonce,
      signature: request.signature,
      action: 'approve',
      now: '2026-08-09T12:01:00.000Z',
    });
    expect(result.action).toBe('approve');
    expect(result.postId).toBe('post-1');

    await expect(
      approvals.consumeCallback({
        requestId: request.id,
        tenantId: 'tenant-a',
        telegramUserId: 'tg-user-a',
        nonce: request.nonce,
        signature: request.signature,
        action: 'reject',
        now: '2026-08-09T12:02:00.000Z',
      }),
    ).rejects.toThrow('telegram_mock_nonce_already_consumed');
  });

  it('rejects expired approvals', async () => {
    const approvals = new TelegramApprovalMock('local-test-signing-secret-123456');
    const request = await approvals.createRequest({
      tenantId: 'tenant-a',
      postId: 'post-2',
      telegramUserId: 'tg-user-a',
      now: '2026-08-09T12:00:00.000Z',
      ttlSeconds: 30,
    });

    await expect(
      approvals.consumeCallback({
        requestId: request.id,
        tenantId: 'tenant-a',
        telegramUserId: 'tg-user-a',
        nonce: request.nonce,
        signature: request.signature,
        action: 'approve',
        now: '2026-08-09T12:01:00.000Z',
      }),
    ).rejects.toThrow('telegram_mock_request_expired');
  });
});
