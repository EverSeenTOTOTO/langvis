import { ClientNode, NodeSharedData } from '@/shared/node';
import { Button, ButtonProps } from '@radix-ui/themes';
import { Handle, HandleProps } from '@xyflow/react';

export default (props: ClientNode<ButtonProps & NodeSharedData>) => {
  return (
    <>
      <Button />
      {props.data?.slots?.map(slot => (
        <Handle {...(slot as unknown as HandleProps)} id={slot.name} />
      ))}
    </>
  );
};
