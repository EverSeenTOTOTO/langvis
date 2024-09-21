import { Button, ButtonProps } from '@radix-ui/themes';
import { Node, NodeProps, Handle, Position } from '@xyflow/react';

export default (props: NodeProps<Node<ButtonProps>>) => {
  return (
    <>
      <Button {...props.data} />
      <Handle type="source" position={Position.Left} />
      <Handle type="target" position={Position.Right} />
    </>
  );
};
