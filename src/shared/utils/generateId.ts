// Prefixed ID with 8 random hex chars: crypto.randomUUID when available, else Math.random fallback.
// Safe from server and client code. Example: generateId('conv') => 'conv_a1b2c3d4'
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
