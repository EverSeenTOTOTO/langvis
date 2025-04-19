import DropdownMenu, {
  DropdownMenuItem,
  DropdownProps,
} from '@/client/components/Dropdown';
import { useStore } from '@/client/store';
import { NodeInitialData } from '@/shared/entities/NodeMeta';
import { message, Tooltip } from 'antd';
import { groupBy, sortBy } from 'lodash-es';
import { computed } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useAsyncFn } from 'react-use';

const ContextMenu: React.FC<Omit<DropdownProps, 'items'>> = props => {
  const setting = useStore('setting');
  const home = useStore('home');
  const graph = useStore('graph');

  const createNodeApi = useAsyncFn(home.createNode.bind(home));

  const items = computed(() => {
    const groupedByType = groupBy(home.availableNodemetas, each => each.type);
    const result: DropdownMenuItem[] = [];

    Object.keys(groupedByType).forEach(type => {
      result.push({
        type: 'divider',
        key: type,
        orientationMargin: 8,
        children: <span>{setting.tr(type).toUpperCase()}</span>,
      });

      sortBy(groupedByType[type], x => x.name).forEach(meta => {
        result.push({
          type: 'item',
          key: meta.name,
          label: `${meta.name.charAt(0).toUpperCase()}${meta.name.slice(1)}`,
          async onClick(e) {
            if (!graph.flow) {
              message.warning(setting.tr('Graph not initialized'));
              return;
            }

            const flowPosition = graph.flow.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            const initialData = NodeInitialData[meta.name] as any;

            await createNodeApi[1]({
              type: meta.name,
              position: flowPosition,
              data: {
                ...initialData,
                graphId: home.currentGraphId!,
              },
            });
          },
          render({ dom }) {
            return (
              <Tooltip title={meta.description || meta.name} placement="right">
                {dom}
              </Tooltip>
            );
          },
        });
      });
    });

    return result;
  });

  return (
    <DropdownMenu
      trigger={['contextMenu']}
      overlayStyle={{
        border: '1px solid var(--ant-color-border)',
        minWidth: 120,
      }}
      {...props}
      items={items.get()}
    />
  );
};

export default observer(ContextMenu);
