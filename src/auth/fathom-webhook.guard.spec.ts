import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { FathomWebhookGuard } from './fathom-webhook.guard';
import type { ExecutionContext } from '@nestjs/common';

const VALID_SECRET = 'test-webhook-secret-for-fathom-hmac';

function makeConfigService(secret: string): ConfigService {
  return {
    getOrThrow: vi.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
}

function makeHmacSig(secret: string, id: string, ts: string, body: string): string {
  const toSign = `${id}.${ts}.${body}`;
  const b64 = createHmac('sha256', Buffer.from(secret, 'utf8')).update(toSign).digest('base64');
  return `v1,${b64}`;
}

function makeContext(opts: {
  webhookId?: string;
  webhookTs?: string;
  webhookSig?: string;
  rawBody?: Buffer;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          ...(opts.webhookId !== undefined && { 'webhook-id': opts.webhookId }),
          ...(opts.webhookTs !== undefined && { 'webhook-timestamp': opts.webhookTs }),
          ...(opts.webhookSig !== undefined && { 'webhook-signature': opts.webhookSig }),
        },
        rawBody: opts.rawBody,
      }),
    }),
  } as unknown as ExecutionContext;
}

const nowTs = () => String(Math.floor(Date.now() / 1000));

describe('FathomWebhookGuard', () => {
  it('throws UnauthorizedException when webhook-id header is missing', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ctx = makeContext({
      webhookTs: nowTs(),
      webhookSig: 'v1,somesig',
      rawBody: Buffer.from('{}'),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when webhook-timestamp header is missing', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookSig: 'v1,somesig',
      rawBody: Buffer.from('{}'),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when webhook-signature header is missing', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookTs: nowTs(),
      rawBody: Buffer.from('{}'),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when timestamp is older than 5 minutes', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const staleTs = String(Math.floor(Date.now() / 1000) - 6 * 60); // 6 min ago
    const body = '{}';
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookTs: staleTs,
      webhookSig: makeHmacSig(VALID_SECRET, 'id-1', staleTs, body),
      rawBody: Buffer.from(body),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when rawBody is absent', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ts = nowTs();
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookTs: ts,
      webhookSig: 'v1,somesig',
      rawBody: undefined,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature has no v1 prefix', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ts = nowTs();
    const body = '{"id":1}';
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookTs: ts,
      webhookSig: 'v2,invalidsig',
      rawBody: Buffer.from(body),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when HMAC signature does not match', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const ts = nowTs();
    const body = '{"id":1}';
    const wrongSig = makeHmacSig('wrong-secret', 'id-1', ts, body);
    const ctx = makeContext({
      webhookId: 'id-1',
      webhookTs: ts,
      webhookSig: wrongSig,
      rawBody: Buffer.from(body),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true when HMAC signature is correct', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const id = 'msg-abc';
    const ts = nowTs();
    const body = '{"id":42,"recording_id":7}';
    const sig = makeHmacSig(VALID_SECRET, id, ts, body);
    const ctx = makeContext({
      webhookId: id,
      webhookTs: ts,
      webhookSig: sig,
      rawBody: Buffer.from(body),
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('accepts space-separated signature header and uses the v1 token', () => {
    const guard = new FathomWebhookGuard(makeConfigService(VALID_SECRET));
    const id = 'msg-xyz';
    const ts = nowTs();
    const body = '{"id":1}';
    const v1Sig = makeHmacSig(VALID_SECRET, id, ts, body);
    const multiSig = `v0,oldsig ${v1Sig}`;
    const ctx = makeContext({
      webhookId: id,
      webhookTs: ts,
      webhookSig: multiSig,
      rawBody: Buffer.from(body),
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
