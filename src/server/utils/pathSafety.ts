import path from 'path';

export function validateFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;

  if (
    filename.includes('\x00') ||
    filename.includes('\n') ||
    filename.includes('\r') ||
    filename.includes('\t')
  ) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    return false;
  }

  const isUnsafe = (n: string) =>
    n.includes('..') || n.startsWith('/') || n.includes('\\');
  if (isUnsafe(path.normalize(filename)) || isUnsafe(path.normalize(decoded))) {
    return false;
  }

  return true;
}

export function resolveSafePath(filename: string, baseDir: string): string {
  if (!validateFilename(filename)) {
    throw new Error(`Invalid filename: ${filename}`);
  }

  const filePath = path.join(baseDir, filename);
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolved.startsWith(resolvedBase)) {
    throw new Error(`Path escapes base directory: ${filename}`);
  }

  return resolved;
}
