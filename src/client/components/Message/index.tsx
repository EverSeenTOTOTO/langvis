import * as React from 'react';
import './index.scss';
import { Callout, Flex } from '@radix-ui/themes';
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { useMemo } from 'react';
import { useStore } from '@/client/store';
import { uniqueId } from 'lodash-es';
import useAnimationState from '@/client/hooks/useAnimationState';

type MessageProps = {
  id: string;
  type: 'info' | 'warn' | 'success' | 'error';
  message: React.ReactNode;
  timeout: number;
  timeoutId: any;
  unmount: () => void;
};

export type MessageConfig = Partial<
  Omit<MessageProps, 'timeoutId' | 'unmount'>
>;

const Message: React.FC<MessageProps> = ({
  type,
  message,
  timeout,
  unmount,
  timeoutId: propsTimeoutId,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const timeoutId = React.useRef(propsTimeoutId);

  React.useEffect(() => () => clearTimeout(timeoutId.current), []);

  const animationState = useAnimationState({ ref });

  const [color, icon] = useMemo(() => {
    switch (type) {
      case 'success':
        return ['green', <CheckCircledIcon />];
      case 'error':
        return ['red', <CrossCircledIcon />];
      case 'warn':
        return ['orange', <ExclamationTriangleIcon />];
      case 'info':
        return ['blue', <InfoCircledIcon />];
      default:
        return ['gray', <InfoCircledIcon />];
    }
  }, [type]);

  return (
    <Callout.Root
      ref={ref}
      className="message"
      color={color as 'red'}
      onMouseEnter={() => {
        // prevent unmounting when hovering
        clearTimeout(timeoutId.current);
      }}
      onMouseLeave={() => {
        timeoutId.current = setTimeout(unmount, timeout);
      }}
      {...animationState}
    >
      <Callout.Icon>{icon}</Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
};

const MessageViewport = () => {
  const [messages, setMessages] = React.useState<MessageProps[]>([]);
  const ui = useStore('ui');

  React.useEffect(() => {
    ui.setNotify(message => {
      return new Promise(resolve => {
        const id = message.id || uniqueId();
        const type = message.type || 'info';
        const timeout = message.timeout || 3000;

        const unmount = () => {
          setMessages(prevMessages => {
            const index = prevMessages.findIndex(each => each.id === id);

            if (index > -1) {
              prevMessages.splice(index, 1);
            }

            return [...prevMessages];
          });
          resolve();
        };

        setMessages(prevMessages => [
          ...prevMessages,
          {
            id,
            type,
            timeout,
            unmount,
            message: message.message || '',
            timeoutId: setTimeout(unmount, timeout),
          },
        ]);
      });
    });
  }, []);

  return (
    <Flex className="message-viewport" direction="column" gapY="3">
      {messages.map(message => {
        return <Message key={message.id!} {...message} />;
      })}
    </Flex>
  );
};

export default MessageViewport;
