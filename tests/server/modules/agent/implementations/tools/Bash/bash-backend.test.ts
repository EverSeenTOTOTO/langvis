import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ pid: undefined, exitCode: null })),
  execFileSync: vi.fn(() => undefined),
}));

import {
  spawn as mockedSpawn,
  execFileSync as mockedExec,
} from 'child_process';
import {
  DirectBash,
  DockerBash,
} from '@/server/modules/agent/implementations/tools/Bash/bash-backend';

const lastSpawnArgv = (): string[] => {
  const call = vi.mocked(mockedSpawn).mock.calls.at(-1)!;
  expect(call[0]).toBe('docker');
  return call[1] as string[];
};

describe('BashBackend', () => {
  beforeEach(() => {
    vi.mocked(mockedSpawn).mockClear();
    vi.mocked(mockedExec).mockClear();
  });

  it('DirectBash guards autonomous runs; DockerBash does not (sandbox is the boundary)', () => {
    expect(new DirectBash().requiresReadonlyGuard).toBe(true);
    expect(new DockerBash().requiresReadonlyGuard).toBe(false);
  });

  describe('DockerBash.spawn argv', () => {
    it('bind-mounts workDir at the same path, disables network, caps resources, runs as host uid', () => {
      new DockerBash().spawn('rg foo', '/tmp/wd');
      const argv = lastSpawnArgv();

      expect(argv[0]).toBe('run');
      expect(argv).toContain('--rm');
      expect(argv).toContain('--init');
      expect(argv).toContain('--sig-proxy=true');
      expect(argv).toContain('--network=none');
      expect(argv).toContain('--pids-limit=128');
      expect(argv).toContain('--memory=512m');
      expect(argv.some(a => /^--user=\d+:\d+$/.test(a))).toBe(true);

      // same-path bind mount + container cwd → host and container share one scratch dir
      expect(argv[argv.indexOf('-v') + 1]).toBe('/tmp/wd:/tmp/wd');
      expect(argv[argv.indexOf('-w') + 1]).toBe('/tmp/wd');

      expect(argv).toContain('langvis-bash-sandbox:latest');
      expect(argv[argv.indexOf('sh') + 1]).toBe('-c');
      expect(argv.at(-1)).toBe('rg foo');
    });
  });

  describe('DockerBash.kill', () => {
    it('reads the cidfile and runs docker kill <cid> (group-kill alone orphans the container)', () => {
      const handle = new DockerBash().spawn('sleep 100', '/tmp/wd');
      const argv = lastSpawnArgv();
      const cidFile = argv
        .find(a => a.startsWith('--cidfile='))!
        .slice('--cidfile='.length);

      writeFileSync(cidFile, 'cid_deadbeef');
      handle.kill();

      expect(vi.mocked(mockedExec)).toHaveBeenCalledWith(
        'docker',
        ['kill', 'cid_deadbeef'],
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });
  });
});
