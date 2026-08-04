/** @jsxImportSource react */
import { useEffect, useState } from 'react';

// Cycle frames while active; idle returns frames[0] so callers embed without a branch.
export function useFrameSequence(
  active: boolean,
  frames: readonly string[],
  intervalMs = 120,
): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || frames.length === 0) return;
    const id = setInterval(
      () => setI(v => (v + 1) % frames.length),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [active, intervalMs, frames.length]);
  if (frames.length === 0) return '';
  return active ? (frames[i] ?? frames[0]) : frames[0];
}
