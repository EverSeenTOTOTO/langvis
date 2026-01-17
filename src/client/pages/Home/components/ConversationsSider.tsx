import { useSearchParam } from '@/client/hooks/useSearchParam';
import { useStore } from '@/client/store';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Conversations, type ConversationsProps } from '@ant-design/x';
import { App, Button, Layout, Skeleton, theme, type GetProp } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import { useAsyncFn } from 'react-use';
import ConversationModal from './ConversationModal';

const { useApp } = App;
const { Sider } = Layout;

const ConversationSider: React.FC<{ onConversationChange?: () => void }> = ({
  onConversationChange,
}) => {
  const { token } = theme.useToken();
  const [currentId, setCurrentId] = useSearchParam('conversationId');

  const { modal } = useApp();
  const store = useStore('conversation');
  const settingStore = useStore('setting');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (currentId) {
      store.setCurrentConversationId(currentId);
    }
  }, [currentId]);
  useEffect(() => {
    if (store.currentConversationId) {
      setCurrentId(store.currentConversationId);
    } else {
      setCurrentId(null);
    }
  }, [store.currentConversationId]);

  const createConversationApi = useAsyncFn(
    store.createConversation.bind(store),
  );
  const allConversationsApi = useAsyncFn(store.getAllConversations.bind(store));
  const deleteConversationApi = useAsyncFn(
    store.deleteConversation.bind(store),
  );
  const updateConversationApi = useAsyncFn(
    store.updateConversation.bind(store),
  );

  useEffect(() => {
    allConversationsApi[1]();
  }, []);

  // Map conversation items for the sidebar
  const items: GetProp<ConversationsProps, 'items'> = store.conversations.map(
    conversation => ({
      key: conversation.id,
      label:
        conversation.name ||
        `${settingStore.tr('Conversation')} ${conversation.id.substring(0, 8)}`,
    }),
  );

  const handleEditConversation = (conversationId: string) => {
    setEditingId(conversationId);
  };

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

  const menuConfig: ConversationsProps['menu'] = conversation => ({
    items: [
      {
        label: settingStore.tr('Edit Conversation'),
        key: 'edit',
        icon: <EditOutlined />,
      },
      {
        label: settingStore.tr('Delete'),
        key: 'delete',
        icon: <DeleteOutlined />,
        danger: true,
        loading: deleteConversationApi[0].loading,
      },
    ],
    onClick: menuInfo => {
      menuInfo.domEvent.stopPropagation();
      const conversationId = conversation.key as string;
      const conversationItem = store.conversations.find(
        c => c.id === conversationId,
      );

      if (menuInfo.key === 'edit' && conversationItem) {
        handleEditConversation(conversationId);
      } else if (menuInfo.key === 'delete') {
        handleDeleteConversation(conversationId);
      }
    },
  });

  return (
    <Sider
      className="chat-sider"
      style={{
        background: token.colorBgContainer,
        borderRadius: token.borderRadius,
      }}
    >
      <Skeleton loading={allConversationsApi[0].loading} active>
        <Conversations
          items={items}
          defaultActiveKey={store.currentConversationId || undefined}
          activeKey={store.currentConversationId || undefined}
          onActiveChange={key => {
            setCurrentId(key);
            onConversationChange?.();
          }}
          menu={menuConfig}
        />
      </Skeleton>
      <ConversationModal
        mode="create"
        title={settingStore.tr('New Conversation')}
        confirmLoading={createConversationApi[0].loading}
        onFinish={values => createConversationApi[1](values)}
        initialValues={{ name: settingStore.tr('New Conversation') }}
      >
        <Button block loading={createConversationApi[0].loading}>
          {settingStore.tr('New Conversation')}
        </Button>
      </ConversationModal>
      <ConversationModal
        mode="edit"
        title={settingStore.tr('Edit Conversation')}
        open={!!editingId}
        onCancel={() => setEditingId(null)}
        onFinish={async values => {
          await updateConversationApi[1](values);
          setEditingId(null);
        }}
        initialValues={store.conversations.find(c => c.id === editingId)}
        confirmLoading={updateConversationApi[0].loading}
      />
    </Sider>
  );
};

export default observer(ConversationSider);
