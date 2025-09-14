import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { container, singleton } from 'tsyringe';
import type {
  Agent,
  AgentCallContext,
  AgentStreamCallContext,
} from '../core/agent';
import LlmCallTool from '../core/agent/LlmCall';

@singleton()
export class CompletionService {
  chatCompletion(
    context: AgentCallContext,
    body: Partial<ChatCompletionCreateParamsNonStreaming>,
  ) {
    const llmCallTool = container.resolve(LlmCallTool.Name) as LlmCallTool;

    return llmCallTool.call(context, body);
  }

  streamChatCompletion(
    context: AgentStreamCallContext,
    body: Partial<ChatCompletionCreateParamsStreaming>,
  ) {
    const llmCallTool = container.resolve(LlmCallTool.Name) as LlmCallTool;

    return llmCallTool.streamCall(context, body);
  }

  streamAgentCall(
    context: AgentStreamCallContext & { agent: string },
    body: Partial<ChatCompletionCreateParamsStreaming>,
  ) {
    const agent = container.resolve(context.agent) as Agent;

    return agent.streamCall(context, body);
  }
}
