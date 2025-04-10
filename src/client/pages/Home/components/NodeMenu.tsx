import DropdownMenu, {
  DropdownMenuItem,
  DropdownProps,
} from '@/client/components/Dropdown';
import { useStore } from '@/client/store';
import { NodeInitialData } from '@/shared/entities/NodeMeta';
import { message } from 'antd';
import { groupBy } from 'lodash-es';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';

const NodeMenuDropDown: React.FC<Omit<DropdownProps, 'items'>> = props => {
  const setting = useStore('setting');
  const home = useStore('home');
  const graph = useStore('graph');

  const items = useMemo(() => {
    const groupedByType = groupBy(home.availableNodemetas, each => each.type);
    const result: DropdownMenuItem[] = [];

    Object.keys(groupedByType).forEach(type => {
      result.push({
        type: 'divider',
        key: 'div',
        orientationMargin: 8,
        children: <span>{setting.tr(type).toUpperCase()}</span>,
      });

      groupedByType[type].forEach(meta => {
        result.push({
          type: 'item',
          key: meta.name,
          label: meta.name,
          onClick(e) {
            if (!graph.flow) {
              message.warning(setting.tr('Graph not initialized'));
              return;
            }

            const flowPosition = graph.flow.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            const initialData = NodeInitialData[meta.name] as any;

            home.createNode({
              type: meta.name,
              position: flowPosition,
              data: {
                ...initialData,
                graphId: home.currentGraphId!,
              },
            });
          },
        });
      });
    });

    return result;
  }, [home.availableNodemetas]);

  return <DropdownMenu {...props} items={items} />;
};

export default observer(NodeMenuDropDown);

