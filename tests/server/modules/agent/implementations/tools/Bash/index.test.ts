import { describe, it, expect } from 'vitest';
import { isReadonlyCommand } from '@/server/modules/agent/implementations/tools/Bash/index';

describe('isReadonlyCommand', () => {
  it('allows single read-only commands', () => {
    expect(isReadonlyCommand('rg foo src/')).toBe(true);
    expect(isReadonlyCommand('ls -la')).toBe(true);
    expect(isReadonlyCommand('cat file.txt')).toBe(true);
    expect(isReadonlyCommand('fd . --type f')).toBe(true);
  });

  it('rejects commands with control / redirect / substitution operators', () => {
    expect(isReadonlyCommand('rg foo; rm bar')).toBe(false);
    expect(isReadonlyCommand('cat f > out')).toBe(false);
    expect(isReadonlyCommand('ls | grep x')).toBe(false);
    expect(isReadonlyCommand('echo $(rm x)')).toBe(false);
    expect(isReadonlyCommand('ls && rm x')).toBe(false);
  });

  it('rejects mutating first-token commands even without operators', () => {
    expect(isReadonlyCommand('rm -rf /')).toBe(false);
    expect(isReadonlyCommand('git push')).toBe(false);
    expect(isReadonlyCommand('find . -delete')).toBe(false);
    expect(isReadonlyCommand('mv a b')).toBe(false);
  });
});
