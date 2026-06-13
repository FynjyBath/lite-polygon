import { describe, it, expect } from 'vitest';
import { verifyApiSig, generateApiSig } from '../utils/apiSig';
import crypto from 'crypto';

describe('apiSig', () => {
  const secret = 'test_secret_key_12345';
  const methodName = 'problem.info';
  const time = String(Math.floor(Date.now() / 1000));

  it('generates valid apiSig that verifies', () => {
    const params = { apiKey: 'testkey', time, problemId: '42' };
    const sig = generateApiSig(methodName, params, secret);
    const paramsWithSig = { ...params, apiSig: sig };
    expect(verifyApiSig(methodName, paramsWithSig, secret)).toBe(true);
  });

  it('rejects wrong secret', () => {
    const params = { apiKey: 'testkey', time, problemId: '42' };
    const sig = generateApiSig(methodName, params, secret);
    const paramsWithSig = { ...params, apiSig: sig };
    expect(verifyApiSig(methodName, paramsWithSig, 'wrong_secret')).toBe(false);
  });

  it('rejects expired time', () => {
    const oldTime = String(Math.floor(Date.now() / 1000) - 400); // 400 seconds ago
    const params = { apiKey: 'testkey', time: oldTime };
    const sig = generateApiSig(methodName, params, secret);
    const paramsWithSig = { ...params, apiSig: sig };
    expect(verifyApiSig(methodName, paramsWithSig, secret)).toBe(false);
  });

  it('apiSig starts with 6-char rand prefix', () => {
    const params = { apiKey: 'k', time };
    const sig = generateApiSig(methodName, params, secret);
    expect(sig.length).toBeGreaterThan(6);
    // First 6 chars are hex (2 bytes = 4 hex chars; we use 3 bytes = 6 hex)
    expect(/^[0-9a-f]{6}/.test(sig)).toBe(true);
  });

  it('sorts params lexicographically for signature', () => {
    // Two calls with same params different order should produce same verifiable sig
    const params1 = { apiKey: 'k', time, z: 'z', a: 'a' };
    const sig1 = generateApiSig(methodName, params1, secret);
    const params2 = { z: 'z', a: 'a', apiKey: 'k', time };
    const sig2 = generateApiSig(methodName, params2, secret);
    // Both should verify with either order
    expect(verifyApiSig(methodName, { ...params1, apiSig: sig1 }, secret)).toBe(true);
    expect(verifyApiSig(methodName, { ...params2, apiSig: sig2 }, secret)).toBe(true);
  });

  it('rejects missing apiSig', () => {
    const params = { apiKey: 'k', time };
    expect(verifyApiSig(methodName, params, secret)).toBe(false);
  });

  it('rejects missing time', () => {
    const params = { apiKey: 'k', apiSig: 'abcdef' + '0'.repeat(128) };
    expect(verifyApiSig(methodName, params, secret)).toBe(false);
  });
});
