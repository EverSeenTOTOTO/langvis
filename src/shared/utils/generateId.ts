/**
 * Generate a prefixed ID with 8 random hex characters
 * @example generateId('conv') => 'conv_a1b2c3d4'
 */
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
