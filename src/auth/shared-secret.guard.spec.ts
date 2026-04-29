import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedSecretGuard } from './shared-secret.guard';
import type { ExecutionContext } from '@nestjs/common';

const VALID_SECRET = 'a'.repeat(32); // 32 chars, minimum valid length

function makeContext(authHeader: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
        path: '/api/test',
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeConfigService(secret: string) {
  return {
    getOrThrow: vi.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
}

describe('SharedSecretGuard', () => {
  it('constructor throws if CORTEX_LOCAL_SHARED_SECRET is missing (getOrThrow throws)', () => {
    const config = {
      getOrThrow: vi.fn().mockImplementation(() => {
        throw new Error('Missing env var');
      }),
    } as unknown as ConfigService;

    expect(() => new SharedSecretGuard(config)).toThrow('Missing env var');
  });

  it('constructor throws if secret is shorter than 32 chars', () => {
    const config = makeConfigService('short');
    expect(() => new SharedSecretGuard(config)).toThrow(
      'CORTEX_LOCAL_SHARED_SECRET must be at least 32 characters',
    );
  });

  it('canActivate throws UnauthorizedException when Authorization header is absent', () => {
    const guard = new SharedSecretGuard(makeConfigService(VALID_SECRET));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow('Missing bearer token');
  });

  it('canActivate throws UnauthorizedException when header lacks Bearer prefix', () => {
    const guard = new SharedSecretGuard(makeConfigService(VALID_SECRET));
    expect(() => guard.canActivate(makeContext('Basic sometoken'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(makeContext('Basic sometoken'))).toThrow('Missing bearer token');
  });

  it('canActivate throws UnauthorizedException when token has wrong length', () => {
    const guard = new SharedSecretGuard(makeConfigService(VALID_SECRET));
    // 31 chars — shorter than VALID_SECRET
    expect(() => guard.canActivate(makeContext(`Bearer ${'b'.repeat(31)}`))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(makeContext(`Bearer ${'b'.repeat(31)}`))).toThrow(
      'Invalid token',
    );
  });

  it('canActivate throws UnauthorizedException when token is same length but different bytes', () => {
    // VALID_SECRET is 'a'.repeat(32); provide 'b'.repeat(32) — same length, different bytes
    const guard = new SharedSecretGuard(makeConfigService(VALID_SECRET));
    expect(() => guard.canActivate(makeContext(`Bearer ${'b'.repeat(32)}`))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(makeContext(`Bearer ${'b'.repeat(32)}`))).toThrow(
      'Invalid token',
    );
  });

  it('canActivate returns true when bearer token exactly matches CORTEX_LOCAL_SHARED_SECRET', () => {
    const guard = new SharedSecretGuard(makeConfigService(VALID_SECRET));
    const result = guard.canActivate(makeContext(`Bearer ${VALID_SECRET}`));
    expect(result).toBe(true);
  });
});
