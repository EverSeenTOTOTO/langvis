import { InstrinicNodes } from '@/shared/types';
import { Image } from 'antd';
import { Handle } from '@xyflow/react';
import { observer } from 'mobx-react-lite';

const ImagePreview = (props: InstrinicNodes['image']) => {
  return (
    <>
      <Image
        width={64}
        src="https://zos.alipayobjects.com/rmsportal/jkjgkEfvpUPVyRjUImniVslZfWPnJuuZ.png"
        {...props.data}
      />
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

export default observer(ImagePreview);
