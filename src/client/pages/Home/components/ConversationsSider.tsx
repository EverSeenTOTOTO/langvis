import ClientOnly from '@/client/components/ClientOnly';
import { useSearchParam } from '@/client/hooks/useSearchParam';
import { useStore } from '@/client/store';
import { UNGROUPED_GROUP_NAME } from '@/shared/constants';
import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FolderOutlined,
  MessageOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Dropdown,
  Flex,
  Layout,
  Skeleton,
  Tag,
  Tooltip,
  Tree,
  theme,
  type MenuProps,
  type TreeProps,
} from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncFn } from 'react-use';
import ConversationModal from './ConversationModal';
import GroupModal from './GroupModal';

const { useApp } = App;
const { Sider } = Layout;

const ConversationSider: React.FC<{ onConversationChange?: () => void }> = ({
  onConversationChange,
}) => {
  const { token } = theme.useToken();

  const { modal } = useApp();
  const store = useStore('conversation');
  const settingStore = useStore('setting');
  const groupStore = useStore('conversationGroup');
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [createWithGroupId, setCreateWithGroupId] = useState<string | null>(
    null,
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [paramConversationId, setParamConversationId] =
    useSearchParam('conversationId');

  const createConversationApi = useAsyncFn(
    store.createConversation.bind(store),
  );
  const allGroupsApi = useAsyncFn(groupStore.getAllGroups.bind(groupStore));
  const deleteConversationApi = useAsyncFn(
    store.deleteConversation.bind(store),
  );
  const updateConversationApi = useAsyncFn(
    store.updateConversation.bind(store),
  );
  const deleteGroupApi = useAsyncFn(groupStore.deleteGroup.bind(groupStore));
  const reorderApi = useAsyncFn(groupStore.reorderItems.bind(groupStore));
  const reorderConversationsInGroupApi = useAsyncFn(
    groupStore.reorderConversationsInGroup.bind(groupStore),
  );
  const updateGroupApi = useAsyncFn(groupStore.updateGroup.bind(groupStore));

  useEffect(() => {
    allGroupsApi[1]();
  }, []);

  // 初始化时从 URL 恢复会话 ID
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (groupStore.groups.length > 0) {
      initializedRef.current = true;
      if (
        paramConversationId &&
        store.findConversationById(paramConversationId)
      ) {
        store.currentConversationId = paramConversationId;
      } else {
        store.currentConversationId = store.getFirstConversationId();
      }
    }
  }, [groupStore.groups, paramConversationId]);

  // store 变化同步到 URL 和展开分组
  useEffect(() => {
    if (store.currentConversationId) {
      if (store.currentConversationId !== paramConversationId) {
        setParamConversationId(store.currentConversationId);
      }
      const groupId = groupStore.findGroupIdByConversationId(
        store.currentConversationId,
      );
      if (groupId) {
        const groupKey = `group-${groupId}`;
        setExpandedKeys(prev => {
          if (!prev.includes(groupKey)) {
            return [...prev, groupKey];
          }
          return prev;
        });
      }
    }
  }, [store.currentConversationId]);

  // 构建 Tree 数据
  const treeData = useMemo(() => {
    return groupStore.sortedGroups.map(group => {
      const isUngrouped = group.name === UNGROUPED_GROUP_NAME;
      const groupMenuItems: MenuProps['items'] = [
        {
          key: 'new-conversation',
          icon: <PlusOutlined />,
          label: settingStore.tr('New Conversation'),
          onClick: () => {
            setCreateWithGroupId(group.id);
          },
        },
        ...(isUngrouped
          ? []
          : [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: settingStore.tr('Edit'),
                onClick: () => setEditingGroupId(group.id),
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: settingStore.tr('Delete'),
                danger: true,
                onClick: () => handleDeleteGroup(group.id),
              },
            ]),
      ];

      return {
        key: `group-${group.id}`,
        title: (
          <>
            <span className="tree-node-text">{group.name}</span>
            <Dropdown menu={{ items: groupMenuItems }} trigger={['click']}>
              <Button
                type="text"
                size="small"
                icon={<EllipsisOutlined />}
                className="tree-node-menu-btn"
                onClick={e => e.stopPropagation()}
              />
            </Dropdown>
          </>
        ),
        icon: <FolderOutlined />,
        children:
          group.conversations
            ?.slice()
            .sort((a, b) => a.order - b.order)
            .map(conv => {
              const convTitle =
                conv.name ||
                `${settingStore.tr('Conversation')} ${conv.id.substring(0, 8)}`;
              const agentId = conv.config?.agent;
              const modelCode = conv.config?.model?.code;
              const memoryType = conv.config?.memory?.type;

              const convMenuItems: MenuProps['items'] = [
                {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: settingStore.tr('Edit'),
                  onClick: () => setEditingConversationId(conv.id),
                },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: settingStore.tr('Delete'),
                  danger: true,
                  onClick: () => handleDeleteConversation(conv.id),
                },
              ];

              const hasMeta = agentId || modelCode || memoryType;
              const title = (
                <Tooltip
                  title={
                    <Flex gap={4} vertical>
                      <span>{convTitle}</span>
                      {hasMeta && (
                        <Flex gap={4} wrap>
                          {agentId && <Tag color="blue">{agentId}</Tag>}
                          {modelCode && <Tag color="purple">{modelCode}</Tag>}
                          {memoryType && <Tag color="green">{memoryType}</Tag>}
                        </Flex>
                      )}
                    </Flex>
                  }
                  placement="right"
                  mouseEnterDelay={0.5}
                >
                  <span className="tree-node-text">{convTitle}</span>
                </Tooltip>
              );
              const titleMenu = (
                <Dropdown menu={{ items: convMenuItems }} trigger={['click']}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EllipsisOutlined />}
                    className="tree-node-menu-btn"
                    onClick={e => e.stopPropagation()}
                  />
                </Dropdown>
              );

              return {
                key: conv.id,
                title: (
                  <>
                    {title}
                    {titleMenu}
                  </>
                ),
                icon: <MessageOutlined />,
                isLeaf: true,
              };
            }) || [],
      };
    });
  }, [groupStore.sortedGroups, settingStore]);

  const handleDeleteConversation = (conversationId: string) => {
    modal.confirm({
      title: settingStore.tr('Delete Conversation'),
      content: settingStore.tr(
        'Are you sure you want to delete? This action cannot be undone.',
      ),
      okText: settingStore.tr('Delete'),
      okType: 'danger',
      cancelText: settingStore.tr('Cancel'),
      onOk: async () => {
        await deleteConversationApi[1]({ id: conversationId });
      },
    });
  };

  const handleDeleteGroup = (groupId: string) => {
    modal.confirm({
      title: settingStore.tr('Delete Group'),
      content: settingStore.tr(
        'This will delete all conversations in this group. Are you sure?',
      ),
      okText: settingStore.tr('Delete'),
      okType: 'danger',
      cancelText: settingStore.tr('Cancel'),
      onOk: async () => {
        await deleteGroupApi[1]({ id: groupId });
      },
    });
  };

  const onSelect: TreeProps['onSelect'] = selectedKeys => {
    const key = selectedKeys[0] as string;
    if (!key) return;

    if (key.startsWith('group-')) {
      // 点击分组时展开/折叠
      setExpandedKeys(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
      );
    } else {
      store.currentConversationId = key;
      onConversationChange?.();
    }
  };

  return (
    <Sider
      className="chat-sider"
      style={{
        background: token.colorBgContainer,
        borderRadius: token.borderRadius,
      }}
    >
      <Skeleton loading={allGroupsApi[0].loading} active>
        <ClientOnly fallback={<Skeleton active />}>
          <Tree
            showIcon
            showLine
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            onExpand={keys => setExpandedKeys(keys as string[])}
            selectedKeys={
              store.currentConversationId ? [store.currentConversationId] : []
            }
            onSelect={onSelect}
            draggable
            style={{ marginBlock: '6px 12px' }}
            onDrop={info => {
              const dropKey = info.node.key as string;
              const dragKey = info.dragNode.key as string;
              const dropPos = info.node.pos?.split('-').map(Number) || [];
              const dropPosition =
                info.dropPosition - Number(dropPos[dropPos.length - 1]);

              const isDragGroup = dragKey.startsWith('group-');
              const isDropGroup = dropKey.startsWith('group-');
              const dragId = isDragGroup
                ? dragKey.replace('group-', '')
                : dragKey;
              const dropId = isDropGroup
                ? dropKey.replace('group-', '')
                : dropKey;

              // 拖拽分组
              if (isDragGroup && isDropGroup) {
                const newOrder = groupStore.groups.map(g => g.order);
                const dragIndex = groupStore.groups.findIndex(
                  g => g.id === dragId,
                );
                const dropIndex = groupStore.groups.findIndex(
                  g => g.id === dropId,
                );
                const targetIndex =
                  dropPosition < 0 ? dropIndex : dropIndex + 1;

                const [removed] = newOrder.splice(dragIndex, 1);
                newOrder.splice(targetIndex, 0, removed);

                const items = groupStore.groups.map(g => ({
                  id: g.id,
                  type: 'group' as const,
                  order: newOrder.indexOf(g.order),
                }));

                reorderApi[1]({ items });
                return;
              }

              // 拖拽对话（组内排序）
              if (!isDragGroup && !isDropGroup) {
                const dragGroup = groupStore.groups.find(g =>
                  g.conversations?.some(c => c.id === dragId),
                );
                const dropGroup = groupStore.groups.find(g =>
                  g.conversations?.some(c => c.id === dropId),
                );

                if (dragGroup && dropGroup && dragGroup.id === dropGroup.id) {
                  const conversations = dragGroup.conversations || [];
                  const newOrder = conversations.map(c => c.order);
                  const dragIndex = conversations.findIndex(
                    c => c.id === dragId,
                  );
                  const dropIndex = conversations.findIndex(
                    c => c.id === dropId,
                  );
                  const targetIndex =
                    dropPosition < 0 ? dropIndex : dropIndex + 1;

                  const [removed] = newOrder.splice(dragIndex, 1);
                  newOrder.splice(targetIndex, 0, removed);

                  const items = conversations.map(c => ({
                    id: c.id,
                    order: newOrder.indexOf(c.order),
                  }));

                  reorderConversationsInGroupApi[1]({
                    groupId: dragGroup.id,
                    items,
                  });
                }
              }
            }}
          />
        </ClientOnly>
      </Skeleton>
      <ConversationModal
        mode="create"
        title={settingStore.tr('New Conversation')}
        confirmLoading={createConversationApi[0].loading}
        onFinish={async values => {
          const { switchToNew, ...restValues } = values;
          const result = await createConversationApi[1](restValues);
          if (switchToNew && result) {
            store.currentConversationId = (result as { id: string }).id;
          }
        }}
        initialValues={{ name: settingStore.tr('New Conversation') }}
      >
        <Button block loading={createConversationApi[0].loading}>
          {settingStore.tr('New Conversation')}
        </Button>
      </ConversationModal>
      <ConversationModal
        mode="create"
        title={settingStore.tr('New Conversation')}
        open={createWithGroupId !== null}
        onCancel={() => setCreateWithGroupId(null)}
        confirmLoading={createConversationApi[0].loading}
        onFinish={async values => {
          const { switchToNew, ...restValues } = values;
          const result = await createConversationApi[1](restValues);
          if (switchToNew && result) {
            store.currentConversationId = (result as { id: string }).id;
          }
          setCreateWithGroupId(null);
        }}
        initialValues={{
          name: settingStore.tr('New Conversation'),
          groupId: createWithGroupId,
        }}
      />
      <ConversationModal
        mode="edit"
        title={settingStore.tr('Edit Conversation')}
        open={!!editingConversationId}
        onCancel={() => setEditingConversationId(null)}
        onFinish={async values => {
          await updateConversationApi[1]({
            id: editingConversationId!,
            name: values.name,
            config: values.config,
          });
          setEditingConversationId(null);
        }}
        initialValues={store.findConversationById(editingConversationId!)}
        confirmLoading={updateConversationApi[0].loading}
      />
      <GroupModal
        title={settingStore.tr('Edit Group')}
        open={!!editingGroupId}
        onCancel={() => setEditingGroupId(null)}
        initialValues={groupStore.groups.find(g => g.id === editingGroupId)}
        onFinish={async values => {
          await updateGroupApi[1]({
            id: editingGroupId!,
            name: values.name,
          });
          setEditingGroupId(null);
        }}
      />
    </Sider>
  );
};

export default observer(ConversationSider);
