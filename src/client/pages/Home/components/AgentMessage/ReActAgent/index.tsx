import MarkdownRender from '@/client/components/MarkdownRender';
import { AgentEvent } from '@/shared/types';
import { Message } from '@/shared/types/entities';
import EventRenderer from '../../EventRenderer';

interface AgentRenderResult {
  content: React.ReactNode;
  isLoading: boolean;
}

const ReActAgentMessage = ({ msg }: { msg: Message }): AgentRenderResult => {
  const events = msg.meta?.events as AgentEvent[] | undefined;
  const hasEvents = events && events.length > 0;
  const hasFinalOrError = events?.some(e =>
    ['final', 'error'].includes(e.type),
  );

  return {
    content: (
      <>
        {hasEvents && (
          <EventRenderer events={events!} conversationId={msg.conversationId} />
        )}
        <MarkdownRender>{msg.content}</MarkdownRender>
      </>
    ),
    isLoading: !hasEvents && msg.content.length === 0 && !hasFinalOrError,
  };
};

export default ReActAgentMessage;
