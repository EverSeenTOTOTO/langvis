import { useStore } from '@/client/store';
import { NodeMetaEntity, NodeMetaName } from '@/shared/entities/NodeMeta';
import {
  Background,
  Controls,
  EdgeChange,
  NodeChange,
  NodeTypes,
  ReactFlow,
  ReactFlowProps,
} from '@xyflow/react';
import { message } from 'antd';
import { observer } from 'mobx-react-lite';
import { useDrop } from 'react-dnd';

const nodeComponents = import.meta.glob('@/client/components/Nodes/*.tsx', {
  eager: true,
}) as any;

const nodeTypes = Object.keys(nodeComponents).reduce((acc, path) => {
  const type = path
    .match(/src\/client\/components\/Nodes\/(.*)\.tsx$/)![1]
    .toLowerCase();

  return {
    ...acc,
    [type]: nodeComponents[path].default,
  };
}, {} as NodeTypes);

function Graph(props: ReactFlowProps) {
  const setting = useStore('setting');
  const home = useStore('home');
  const graph = useStore('graph');

  const [, drop] = useDrop(() => ({
    accept: Object.values(NodeMetaName),
    drop: (item: NodeMetaEntity, monitor) => {
      if (!graph.flow) {
        message.warning(setting.tr('Graph not initialized'));
        return;
      }

      const clientOffset = monitor.getClientOffset();
      const flowPosition = graph.flow!.screenToFlowPosition(clientOffset!);

      home.createNode({
        name: item.name,
        type: item.name,
        position: flowPosition,
        graphId: home.currentGraphId!,
        data: {},
      });
    },
    collect: monitor => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  return (
    <ReactFlow
      ref={drop}
      fitView
      nodeTypes={nodeTypes}
      colorMode={setting.mode}
      onInit={flow => graph.setFlow(flow)}
      nodes={graph.nodes}
      onNodesChange={(changes: NodeChange[]) => graph.updateNodes(changes)}
      edges={graph.edges}
      onEdgesChange={(changes: EdgeChange[]) => graph.updateEdges(changes)}
      onConnect={connection => graph.connectNode(connection)}
      {...props}
    >
      <Background />
      <Controls position="bottom-right" />
    </ReactFlow>
  );
}

export default observer(Graph);
