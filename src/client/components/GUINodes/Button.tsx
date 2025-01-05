import { InstrinicNodes } from '@/shared/node';
import { Button } from '@radix-ui/themes';
import { Handle } from '@xyflow/react';
import { observer } from 'mobx-react-lite';

const ButtonNode = (props: InstrinicNodes['button']) => {
  return (
    <>
      <Button loading={props.data.loading}>{props.data.text}</Button>
      {props.data?.slots?.map(slot => (
        <Handle
          {...slot}
          id={slot.name}
          key={slot.name}
          style={{
            backgroundColor: slot.type === 'source' ? 'cyan' : 'yellow',
          }}
        />
      ))}
    </>
  );
};

export default observer(ButtonNode);
