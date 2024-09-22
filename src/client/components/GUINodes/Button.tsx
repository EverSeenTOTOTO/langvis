import { Button, ButtonProps } from '@radix-ui/themes';
import { Node, NodeProps, Handle, Position } from '@xyflow/react';

export default (props: NodeProps<Node<ButtonProps>>) => {
  return (
    <>
      <Button {...props.data} />
      <Handle id="output" type="source" position={Position.Left} />
      <Handle id="input" type="target" position={Position.Right} />
    </>
  );
};
