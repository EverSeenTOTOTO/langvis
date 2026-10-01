import { HumanInputController } from '@/server/modules/agent/human-input.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRun {
  submitInput: ReturnType<typeof vi.fn>;
  inputStatus: ReturnType<typeof vi.fn>;
}

function makeMockExecutor(active: FakeRun | undefined) {
  return { getActiveRun: vi.fn(() => active) };
}

const runId = 'run_1';

describe('HumanInputController（以 runId 寻址内存中的活跃 AgentRun）', () => {
  let controller: HumanInputController;
  let executor: { getActiveRun: ReturnType<typeof vi.fn> };
  let run: FakeRun;

  beforeEach(() => {
    run = {
      submitInput: vi.fn(),
      inputStatus: vi.fn().mockReturnValue(null),
    };
    executor = makeMockExecutor(run);
    controller = new HumanInputController(executor as any);
    vi.clearAllMocks();
  });

  describe('submitInput', () => {
    it('应返回 404 当 run 不在活跃区（getActiveRun 返回 undefined）', async () => {
      executor.getActiveRun.mockReturnValue(undefined);
      await expect(
        controller.submitInput(runId, { data: {} }),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          success: false,
          error: 'Request not found or expired',
        },
      });
    });

    it('应返回 400 当已提交', async () => {
      run.submitInput.mockReturnValue('already_submitted');
      await expect(
        controller.submitInput(runId, { data: {} }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          success: false,
          error: 'Request already submitted',
        },
      });
    });

    it('提交成功返回 success 并透传 data', async () => {
      run.submitInput.mockReturnValue('success');
      await expect(
        controller.submitInput(runId, { data: { name: 'John' } }),
      ).resolves.toEqual({ success: true });
      expect(run.submitInput).toHaveBeenCalledWith({ name: 'John' }, 'submit');
    });
  });

  describe('getStatus', () => {
    it('无 pending 输入时返回 exists: false', async () => {
      run.inputStatus.mockReturnValue(null);
      await expect(controller.getStatus(runId)).resolves.toEqual({
        exists: false,
      });
    });

    it('返回聚合的 inputStatus（含 exists/submitted/message/schema）', async () => {
      run.inputStatus.mockReturnValue({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
      await expect(controller.getStatus(runId)).resolves.toEqual({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });
  });
});
