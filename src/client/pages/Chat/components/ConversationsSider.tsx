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

const ConversationSider: React.FC = () => {
  const { token } = theme.useToken();

  const siderStyle = {
    width: 256,
    background: token.colorBgContainer,
    borderRadius: token.borderRadius,
  };

  const { modal } = useApp();
  const conversationStore = useStore('conversation');
  const settingStore = useStore('setting');
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);

  const createConversationApi = useAsyncFn(
    conversationStore.createConversation.bind(conversationStore),
  );
  const allConversationsApi = useAsyncFn(
    conversationStore.getAllConversations.bind(conversationStore),
  );
  const deleteConversationApi = useAsyncFn(
    conversationStore.deleteConversation.bind(conversationStore),
  );
  const updateConversationApi = useAsyncFn(
    conversationStore.updateConversation.bind(conversationStore),
  );

  useEffect(() => {
    allConversationsApi[1]();
  }, []);

  // Map conversation items for the sidebar
  const items: GetProp<ConversationsProps, 'items'> =
    conversationStore.conversations.map(conversation => ({
      key: conversation.id,
      label:
        conversation.name ||
        `${settingStore.tr('Conversation')} ${conversation.id.substring(0, 8)}`,
    }));

  const handleEditConversation = (conversationId: string) => {
    setEditingConversationId(conversationId);
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
      const conversationItem = conversationStore.conversations.find(
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
    <Sider width={256} className="chat-sider" style={siderStyle}>
      <Skeleton loading={allConversationsApi[0].loading} active>
        <Conversations
          items={items}
          defaultActiveKey={
            conversationStore.currentConversationId || undefined
          }
          activeKey={conversationStore.currentConversationId || undefined}
          onActiveChange={key => {
            conversationStore.setCurrentConversationId(key);
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
        open={!!editingConversationId}
        onCancel={() => setEditingConversationId(null)}
        onFinish={async values => {
          await updateConversationApi[1](values);
          setEditingConversationId(null);
        }}
        initialValues={conversationStore.conversations.find(
          c => c.id === editingConversationId,
        )}
        confirmLoading={updateConversationApi[0].loading}
      />
    </Sider>
  );
};

export default observer(ConversationSider);
