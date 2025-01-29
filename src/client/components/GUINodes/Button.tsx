import { InstrinicNodes } from '@/shared/node';
import { Handle } from '@xyflow/react';
import { Button } from 'antd';
import { observer } from 'mobx-react-lite';

const ButtonNode = (props: InstrinicNodes['button']) => {
  return (
    <>
      <Button {...props.data}>{props.data.name}</Button>
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
