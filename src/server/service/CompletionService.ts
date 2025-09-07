import { inject, singleton } from 'tsyringe';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import LlmCallTool from '../core/agent/LlmCall';
import type { AgentCallContext, AgentStreamCallContext } from '../core/agent';

@singleton()
export class CompletionService {
  constructor(@inject(LlmCallTool) private readonly llmCallTool: LlmCallTool) {}

  chatCompletion(
    context: AgentCallContext,
    body: Partial<ChatCompletionCreateParamsNonStreaming>,
  ) {
    return this.llmCallTool.call(context, body);
  }

  streamChatCompletion(
    context: AgentStreamCallContext,
    body: Partial<ChatCompletionCreateParamsStreaming>,
  ) {
    return this.llmCallTool.streamCall(context, body);
  }
}
