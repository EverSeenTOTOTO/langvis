import { useStore } from '@/client/store';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Conversations, type ConversationsProps } from '@ant-design/x';
import {
  App,
  Form,
  Input,
  Layout,
  Modal,
  Skeleton,
  theme,
  type GetProp,
} from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import { useAsyncFn } from 'react-use';

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
  const [editForm] = Form.useForm();

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

  const handleEditConversation = (
    conversationId: string,
    currentName: string,
  ) => {
    setEditingConversationId(conversationId);
    editForm.setFieldsValue({ name: currentName });
  };

  const handleDeleteConversation = (conversationId: string) => {
    modal.confirm({
      title: settingStore.tr('Delete Conversation'),
      content: settingStore.tr(
        'Are you sure you want to delete this conversation? This action cannot be undone.',
      ),
      okText: settingStore.tr('Delete'),
      okType: 'danger',
      cancelText: settingStore.tr('Cancel'),
      onOk: async () => {
        await deleteConversationApi[1]({ id: conversationId });
      },
    });
  };

  const handleUpdateConversation = async () => {
    if (!editingConversationId) return;

    const values = await editForm.validateFields();
    await updateConversationApi[1]({
      id: editingConversationId,
      name: values.name,
    });
    setEditingConversationId(null);
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
        handleEditConversation(
          conversationId,
          conversationItem.name ||
            `${settingStore.tr('Conversation')} ${conversationId.substring(0, 8)}`,
        );
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
      <Modal
        width={460}
        title={settingStore.tr('Edit Conversation')}
        open={!!editingConversationId}
        onOk={handleUpdateConversation}
        onCancel={() => setEditingConversationId(null)}
        okText={settingStore.tr('Save')}
        cancelText={settingStore.tr('Cancel')}
        confirmLoading={updateConversationApi[0].loading}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label={settingStore.tr('Conversation Name')}
            rules={[
              {
                required: true,
                message: settingStore.tr('Please enter a conversation name'),
              },
              {
                type: 'string',
                max: 20,
              },
            ]}
          >
            <Input placeholder={settingStore.tr('Enter conversation name')} />
          </Form.Item>
        </Form>
      </Modal>
    </Sider>
  );
};

export default observer(ConversationSider);

