/**
 * Generate a prefixed ID with 8 random hex characters.
 *
 * Uses `crypto.randomUUID` when available (secure browser context / Node ≥19);
 * otherwise falls back to a `Math.random`-based hex string (e.g. a browser over
 * plain HTTP, where `crypto.randomUUID` is undefined). Safe to call from both
 * server and client code in any environment.
 *
 * @example generateId('conv') => 'conv_a1b2c3d4'
 */
export function generateId(prefix: string): string {
  return `${prefix}_${randomHex(8)}`;
}

function randomHex(length: number): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, length);
  }
  let out = '';
  while (out.length < length) out += Math.random().toString(16).slice(2);
  return out.slice(0, length);
}
