import { useStore } from '@/client/store';
import {
  NodeInitialData,
  NodeMetaEntity,
  NodeMetaName,
} from '@/shared/entities/NodeMeta';
import {
  Background,
  Controls,
  EdgeTypes,
  NodeTypes,
  ReactFlow,
  ReactFlowProps,
} from '@xyflow/react';
import { message } from 'antd';
import { pick } from 'lodash-es';
import { observer } from 'mobx-react-lite';
import { useDrop } from 'react-dnd';
import './index.scss';
import { EdgeMetaName } from '@/shared/entities/Edge';

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

const edgeComponents = import.meta.glob('@/client/components/Edges/*.tsx', {
  eager: true,
}) as any;

const edgeTypes = Object.keys(edgeComponents).reduce((acc, path) => {
  const type = path
    .match(/src\/client\/components\/Edges\/(.*)\.tsx$/)![1]
    .toLowerCase();

  return {
    ...acc,
    [type]: edgeComponents[path].default,
  };
}, {} as EdgeTypes);

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
      const flowPosition = graph.flow.screenToFlowPosition(clientOffset!);

      home.createNode({
        type: item.name,
        position: flowPosition,
        data: {
          ...(NodeInitialData[item.name] as any),
          graphId: home.currentGraphId!,
        },
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
      edgeTypes={edgeTypes}
      colorMode={setting.mode}
      onInit={flow => graph.setFlow(flow)}
      nodes={graph.nodes}
      onNodesChange={changes => graph.updateNodes(changes)}
      edges={graph.edges}
      onEdgesChange={changes => graph.updateEdges(changes)}
      onConnect={connection => {
        home.addEdge({
          ...connection,
          type: EdgeMetaName.BEZIER,
          data: { graphId: home.currentGraphId! },
        });
      }}
      onNodeDragStop={(_e, node) => {
        home.updateNode(pick<any>(node, 'id', 'position', 'data', 'type'));
      }}
      {...props}
    >
      <Background />
      <Controls position="bottom-right" />
    </ReactFlow>
  );
}

export default observer(Graph);
