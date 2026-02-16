import MarkdownRender from '@/client/components/MarkdownRender';
import { AgentEvent } from '@/shared/types';
import { Message } from '@/shared/types/entities';
import { observer } from 'mobx-react-lite';
import EventRenderer from '../../EventRenderer';

const ReActAgentMessage = ({ msg }: { msg: Message }) => {
  const events = msg.meta?.events as AgentEvent[] | undefined;
  const hasEvents = events && events.length > 0;

  return (
    <>
      {hasEvents && <EventRenderer events={events!} />}
      <MarkdownRender>{msg.content}</MarkdownRender>
    </>
  );
};

export default observer(ReActAgentMessage);
