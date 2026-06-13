"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const apiSig_1 = require("../utils/apiSig");
(0, vitest_1.describe)('apiSig', () => {
    const secret = 'test_secret_key_12345';
    const methodName = 'problem.info';
    const time = String(Math.floor(Date.now() / 1000));
    (0, vitest_1.it)('generates valid apiSig that verifies', () => {
        const params = { apiKey: 'testkey', time, problemId: '42' };
        const sig = (0, apiSig_1.generateApiSig)(methodName, params, secret);
        const paramsWithSig = { ...params, apiSig: sig };
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, paramsWithSig, secret)).toBe(true);
    });
    (0, vitest_1.it)('rejects wrong secret', () => {
        const params = { apiKey: 'testkey', time, problemId: '42' };
        const sig = (0, apiSig_1.generateApiSig)(methodName, params, secret);
        const paramsWithSig = { ...params, apiSig: sig };
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, paramsWithSig, 'wrong_secret')).toBe(false);
    });
    (0, vitest_1.it)('rejects expired time', () => {
        const oldTime = String(Math.floor(Date.now() / 1000) - 400); // 400 seconds ago
        const params = { apiKey: 'testkey', time: oldTime };
        const sig = (0, apiSig_1.generateApiSig)(methodName, params, secret);
        const paramsWithSig = { ...params, apiSig: sig };
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, paramsWithSig, secret)).toBe(false);
    });
    (0, vitest_1.it)('apiSig starts with 6-char rand prefix', () => {
        const params = { apiKey: 'k', time };
        const sig = (0, apiSig_1.generateApiSig)(methodName, params, secret);
        (0, vitest_1.expect)(sig.length).toBeGreaterThan(6);
        // First 6 chars are hex (2 bytes = 4 hex chars; we use 3 bytes = 6 hex)
        (0, vitest_1.expect)(/^[0-9a-f]{6}/.test(sig)).toBe(true);
    });
    (0, vitest_1.it)('sorts params lexicographically for signature', () => {
        // Two calls with same params different order should produce same verifiable sig
        const params1 = { apiKey: 'k', time, z: 'z', a: 'a' };
        const sig1 = (0, apiSig_1.generateApiSig)(methodName, params1, secret);
        const params2 = { z: 'z', a: 'a', apiKey: 'k', time };
        const sig2 = (0, apiSig_1.generateApiSig)(methodName, params2, secret);
        // Both should verify with either order
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, { ...params1, apiSig: sig1 }, secret)).toBe(true);
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, { ...params2, apiSig: sig2 }, secret)).toBe(true);
    });
    (0, vitest_1.it)('rejects missing apiSig', () => {
        const params = { apiKey: 'k', time };
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, params, secret)).toBe(false);
    });
    (0, vitest_1.it)('rejects missing time', () => {
        const params = { apiKey: 'k', apiSig: 'abcdef' + '0'.repeat(128) };
        (0, vitest_1.expect)((0, apiSig_1.verifyApiSig)(methodName, params, secret)).toBe(false);
    });
});
