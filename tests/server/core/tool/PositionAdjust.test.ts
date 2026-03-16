import { ExecutionContext } from '@/server/core/ExecutionContext';
import { TraceContext } from '@/server/core/TraceContext';
import PositionAdjustTool from '@/server/core/tool/PositionAdjust';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

const mockHumanInputTool = {
  call: vi.fn(),
};

vi.mock('tsyringe', async () => {
  const actual = await vi.importActual('tsyringe');
  return {
    ...actual,
    container: {
      resolve: vi.fn((token: string | symbol) => {
        if (token === ToolIds.ASK_USER) {
          return mockHumanInputTool;
        }
        throw new Error(`Unknown token: ${String(token)}`);
      }),
      register: vi.fn(),
    },
  };
});

async function collectEvents<T>(
  generator: AsyncGenerator<AgentEvent, T, void>,
): Promise<{ events: AgentEvent[]; result: T }> {
  const events: AgentEvent[] = [];
  let result: T;
  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value as T;
      break;
    }
    events.push(value);
  }
  return { events, result };
}

describe('PositionAdjustTool', () => {
  let tool: PositionAdjustTool;

  beforeEach(() => {
    tool = new PositionAdjustTool();
    (tool as any).id = ToolIds.POSITION_ADJUSTMENT_ADVICE;
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    vi.clearAllMocks();
  });

  describe('basic properties', () => {
    it('should have correct tool id', () => {
      expect(tool.id).toBe(ToolIds.POSITION_ADJUSTMENT_ADVICE);
    });
  });

  describe('call - user cancels form', () => {
    it('should return submitted: false when user cancels', async () => {
      const ctx = createMockContext();

      mockHumanInputTool.call.mockImplementation(async function* () {
        yield ctx.agentToolProgressEvent(ToolIds.ASK_USER, {
          status: 'awaiting_input',
        });
        return { submitted: false };
      });

      const generator = tool.call({ conversationId: 'test-conv' }, ctx);

      const { result } = await collectEvents(generator);

      expect(result).toEqual({
        submitted: false,
        advice: '用户取消了表单提交',
      });
    });

    it('should return submitted: false when no data provided', async () => {
      const ctx = createMockContext();

      mockHumanInputTool.call.mockImplementation(async function* () {
        yield ctx.agentToolProgressEvent(ToolIds.ASK_USER, {
          status: 'awaiting_input',
        });
        return { submitted: true, data: null };
      });

      const generator = tool.call({ conversationId: 'test-conv' }, ctx);

      const { result } = await collectEvents(generator);

      expect(result).toEqual({
        submitted: false,
        advice: '用户取消了表单提交',
      });
    });
  });

  describe('call - successful submission', () => {
    it('should call LLM with correct prompt when form is submitted', async () => {
      const ctx = createMockContext();

      const formData = {
        totalAssets: '10万',
        currentPosition: { stocks: '5万', funds: '2万', cash: '3万' },
        marketTemperature: '5',
        personalEmotion: 'neutral',
        targetPosition: { stocks: '50%', funds: '20%', cash: '30%' },
        notes: 'Test note',
      };

      mockHumanInputTool.call.mockImplementation(async function* () {
        yield ctx.agentToolProgressEvent(ToolIds.ASK_USER, {
          status: 'awaiting_input',
        });
        return { submitted: true, data: formData };
      });

      const mockAdvice = '建议减少股票仓位...';
      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        yield ctx.agentStreamEvent(mockAdvice);
        return mockAdvice;
      });

      const generator = tool.call({ conversationId: 'test-conv' }, ctx);

      const { result } = await collectEvents(generator);

      expect(result).toEqual({
        submitted: true,
        advice: mockAdvice,
      });

      const callLlmSpy = vi.mocked(ctx.callLlm);
      expect(callLlmSpy).toHaveBeenCalled();
      const callArgs = callLlmSpy.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages![0].role).toBe('system');
      expect(callArgs.messages![1].role).toBe('user');
      expect(callArgs.messages![1].content).toContain('总资产');
      expect(callArgs.messages![1].content).toContain('10万');
      expect(callArgs.messages![1].content).toContain('当前持仓');
      expect(callArgs.messages![1].content).toContain('股票');
      expect(callArgs.messages![1].content).toContain('5万');
    });

    it('should include all form fields in prompt', async () => {
      const ctx = createMockContext();

      const formData = {
        totalAssets: '50万',
        currentPosition: {
          stocks: '20万',
          funds: '10万',
          bonds: '5万',
          preciousMetals: '2万',
          cash: '13万',
        },
        marketTemperature: '偏悲观',
        personalEmotion: 'fearful',
        targetPosition: {
          stocks: '40%',
          funds: '20%',
          bonds: '10%',
          preciousMetals: '5%',
          cash: '25%',
        },
        stopLoss: '招商银行 30元, 茅台 1500',
        notes: 'Long term investment',
      };

      mockHumanInputTool.call.mockImplementation(async function* () {
        yield ctx.agentToolProgressEvent(ToolIds.ASK_USER, {
          status: 'awaiting_input',
        });
        return { submitted: true, data: formData };
      });

      const callLlmSpy = vi
        .spyOn(ctx, 'callLlm')
        .mockImplementation(async function* () {
          return 'Advice';
        });

      await collectEvents(tool.call({ conversationId: 'test-conv' }, ctx));

      const userMessage = callLlmSpy.mock.calls[0][0].messages![1].content;

      expect(userMessage).toContain('50万');
      expect(userMessage).toContain('20万');
      expect(userMessage).toContain('偏悲观');
      expect(userMessage).toContain('恐惧');
      expect(userMessage).toContain('止损设置');
      expect(userMessage).toContain('招商银行');
      expect(userMessage).toContain('Long term investment');
    });

    it('should handle minimal form data', async () => {
      const ctx = createMockContext();

      const formData = {
        totalAssets: '1万',
      };

      mockHumanInputTool.call.mockImplementation(async function* () {
        return { submitted: true, data: formData };
      });

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        return 'Simple advice';
      });

      const { result } = await collectEvents(
        tool.call({ conversationId: 'test-conv' }, ctx),
      );

      expect(result.submitted).toBe(true);
      expect(result.advice).toBe('Simple advice');
    });
  });

  describe('abort handling', () => {
    it('should throw immediately when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort(new Error('User cancelled'));

      let ctx: ExecutionContext | undefined;
      TraceContext.run(
        { requestId: 'test-req', traceId: 'test-trace-id' },
        () => {
          ctx = new ExecutionContext(abortController);
        },
      );

      const generator = tool.call({ conversationId: 'test-conv' }, ctx!);

      await expect(generator.next()).rejects.toThrow('User cancelled');
    });
  });
});
