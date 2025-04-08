import { InstrinicNodeProps } from '@/shared/types';
import { Select } from 'antd';
import { Handle } from '@xyflow/react';
import { observer } from 'mobx-react-lite';

const SelectNode = (props: InstrinicNodeProps['select']) => {
  return (
    <>
      <Select {...props.data} />
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

export default observer(SelectNode);
