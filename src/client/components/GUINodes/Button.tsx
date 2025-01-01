import { ClientNode, NodeSharedData } from '@/shared/node';
import { Button, ButtonProps } from '@radix-ui/themes';
import { Handle } from '@xyflow/react';

export default (props: ClientNode<ButtonProps & NodeSharedData>) => {
  return (
    <>
      <Button>{props.data.children}</Button>
      {props.data?.slots?.map(slot => (
        <Handle {...slot} id={slot.name} key={slot.name} />
      ))}
    </>
  );
};
