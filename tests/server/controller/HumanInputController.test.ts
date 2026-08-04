import HumanInputController from '@/server/controller/HumanInputController';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRun {
  submitInput: ReturnType<typeof vi.fn>;
  inputStatus: ReturnType<typeof vi.fn>;
}

function makeMockExecutor(active: FakeRun | undefined) {
  return { getActiveRun: vi.fn(() => active) };
}

function createMockResponse() {
  const res = {
    _status: 200,
    _json: null as any,
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: any, data: any) {
      this._json = data;
      return this;
    }),
  };
  return res as any;
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
      const res = createMockResponse();
      await controller.submitInput(runId, { runId, data: {} }, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request not found or expired',
      });
    });

    it('应返回 400 当已提交', async () => {
      run.submitInput.mockReturnValue('already_submitted');
      const res = createMockResponse();
      await controller.submitInput(runId, { runId, data: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request already submitted',
      });
    });

    it('提交成功返回 success 并透传 runId 与 data', async () => {
      run.submitInput.mockReturnValue('success');
      const res = createMockResponse();
      await controller.submitInput(
        runId,
        { runId, data: { name: 'John' } },
        res,
      );
      expect(run.submitInput).toHaveBeenCalledWith({ name: 'John' });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('getStatus', () => {
    it('无 pending 输入时返回 exists: false', async () => {
      run.inputStatus.mockReturnValue(null);
      const res = createMockResponse();
      await controller.getStatus(runId, res);
      expect(res.json).toHaveBeenCalledWith({ exists: false });
    });

    it('返回聚合的 inputStatus（含 exists/submitted/message/schema）', async () => {
      run.inputStatus.mockReturnValue({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
      const res = createMockResponse();
      await controller.getStatus(runId, res);
      expect(res.json).toHaveBeenCalledWith({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });
  });
});
