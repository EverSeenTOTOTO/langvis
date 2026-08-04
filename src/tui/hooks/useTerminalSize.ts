/** @jsxImportSource react */
import { useStdout } from 'ink';

/** Track terminal size, re-rendering on resize. */
export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  return {
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  };
}
