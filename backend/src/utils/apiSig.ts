import crypto from 'crypto';

/**
 * Validate a Polygon-style API signature.
 * Algorithm:
 *   rand = first 6 chars of apiSig
 *   signature = SHA-512( `${rand}/${methodName}?${sortedParams}#${secret}` )
 *   apiSig should equal rand + signature
 *
 * Parameters are sorted lexicographically by name, then by value.
 * The apiSig and apiKey params are excluded from the sorted params.
 */
export function verifyApiSig(
  methodName: string,
  params: Record<string, string>,
  secret: string,
  maxAgeSeconds = 300
): boolean {
  const apiSig = params['apiSig'];
  const time = params['time'];
  if (!apiSig || !time) return false;

  // Check time window
  const ts = parseInt(time);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxAgeSeconds) return false;

  const rand = apiSig.slice(0, 6);

  const filtered: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === 'apiSig') continue;
    filtered.push([k, v]);
  }
  filtered.sort(([a, av], [b, bv]) => {
    if (a !== b) return a < b ? -1 : 1;
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  const paramStr = filtered.map(([k, v]) => `${k}=${v}`).join('&');
  const toHash = `${rand}/${methodName}?${paramStr}#${secret}`;
  const expected = rand + crypto.createHash('sha512').update(toHash).digest('hex');

  return expected === apiSig;
}

export function generateApiSig(
  methodName: string,
  params: Record<string, string>,
  secret: string
): string {
  const rand = crypto.randomBytes(3).toString('hex'); // 6 hex chars
  const filtered: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === 'apiSig') continue;
    filtered.push([k, v]);
  }
  filtered.sort(([a, av], [b, bv]) => {
    if (a !== b) return a < b ? -1 : 1;
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  const paramStr = filtered.map(([k, v]) => `${k}=${v}`).join('&');
  const toHash = `${rand}/${methodName}?${paramStr}#${secret}`;
  return rand + crypto.createHash('sha512').update(toHash).digest('hex');
}
