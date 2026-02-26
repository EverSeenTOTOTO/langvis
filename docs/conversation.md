# 对话分组与排序设计方案

## 一、需求概述

1. **分组功能**：对话可归属分组，分组不支持嵌套，最多两级（分组 → 对话）
2. **排序功能**：未分组对话与分组处于同一层级，可混合排序；分组内对话可排序
3. **删除功能**：删除分组时级联删除其下所有对话，需二次确认
4. **用户隔离**：对话和分组关联用户，实现数据隔离

## 二、数据结构

### 2.1 新增 `ConversationGroup` 实体

```typescript
@Entity('conversation_groups')
export class ConversationGroupEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  order!: number; // 与未分组对话共享第一层排序

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity)
  user!: UserEntity;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @OneToMany(() => ConversationEntity, conversation => conversation.group)
  conversations!: ConversationEntity[];
}
```

### 2.2 修改 `Conversation` 实体

新增字段：

```typescript
@Column({ type: 'uuid', nullable: true })
groupId!: string | null; // null 表示未分组

@Column({ type: 'int', default: 0 })
order!: number; // groupId=null 时为第一层排序，否则为组内排序

@Column({ type: 'uuid' })
userId!: string;

@ManyToOne(() => UserEntity)
user!: UserEntity;

@ManyToOne(() => ConversationGroupEntity, group => group.conversations, { nullable: true })
group!: ConversationGroupEntity | null;
```

### 2.3 排序策略

使用 `order` 整数字段，数值越小越靠前，初始值为创建时同层级最大 order + 100。

**层级说明**：

- **第一层**：分组 + 未分组对话（groupId=null），共用 order 排序
- **第二层**：分组内的对话，按组内 order 排序

## 三、API 设计

### 3.1 分组 API

| 方法   | 路径                          | 说明                                       |
| ------ | ----------------------------- | ------------------------------------------ |
| POST   | `/api/conversation-group`     | 创建分组                                   |
| GET    | `/api/conversation-group`     | 获取当前用户所有分组（含对话）及未分组对话 |
| PUT    | `/api/conversation-group/:id` | 编辑分组名称                               |
| DELETE | `/api/conversation-group/:id` | 删除分组（级联删除对话）                   |

### 3.2 对话 API（修改现有）

| 方法   | 路径                    | 说明                                 |
| ------ | ----------------------- | ------------------------------------ |
| POST   | `/api/conversation`     | 创建对话（可选分组）                 |
| GET    | `/api/conversation`     | 获取当前用户所有对话（返回分组结构） |
| PUT    | `/api/conversation/:id` | 编辑对话                             |
| DELETE | `/api/conversation/:id` | 删除对话                             |

### 3.3 排序 API

```typescript
// POST /api/conversation-group/reorder
// 第一层排序（分组 + 未分组对话）
{
  items: Array<{
    id: string;
    type: 'group' | 'conversation';
    order: number;
  }>;
}

// POST /api/conversation/reorder
// 组内对话排序
{
  groupId: string;
  items: Array<{ id: string; order: number }>;
}
```

### 3.4 关键 API 定义

#### 创建对话

```typescript
// POST /api/conversation
{
  name: string;
  config: { agent: string; [key: string]: any };
  groupId?: string; // 可选，不传则为未分组
}
```

#### 获取列表

```typescript
// GET /api/conversation-group
{
  groups: Array<{
    id: string;
    name: string;
    order: number;
    conversations: Conversation[];
  }>;
  ungroupedConversations: Conversation[]; // groupId=null 的对话
}
```

#### 删除分组

```typescript
// DELETE /api/conversation-group/:id
// 行为：级联删除该分组下所有对话
{
  success: boolean;
  deletedConversationIds: string[];
}
```

## 四、前端交互

### 4.1 组件方案

使用 ant-design `Tree` 组件替代 `@ant-design/x Conversations`。

### 4.2 Tree 结构示例

```
├── 分组A (order: 100)
│   ├── 对话1 (order: 100)
│   └── 对话2 (order: 200)
├── 对话X (order: 150, groupId: null)  ← 未分组对话
├── 分组B (order: 300)
│   └── 对话3
└── 对话Y (order: 350, groupId: null)
```

### 4.3 节点交互

**分组节点**

- 左侧：折叠/展开箭头
- 右侧：「...」菜单 →【编辑分组】、【删除分组】
- 拖拽：支持第一层级排序

**对话节点**（包括分组内和未分组）

- 左侧：对话图标
- 右侧：「...」菜单 →【编辑对话】
- 拖拽：未分组对话支持第一层级排序，分组内对话支持组内排序

### 4.4 新建对话

- 位置：对话列表末尾，「New Conversation」按钮
- 弹窗表单：
  - 名称（必填）
  - 分组（下拉选择已有分组，可选）
  - Agent 配置（沿用现有）
- 不选分组 → groupId=null

### 4.5 编辑弹窗

- 对话：沿用现有 `ConversationModal`
- 分组：新弹窗，仅 name 字段

## 五、特殊规则

### 删除分组

级联删除该分组下所有对话，需二次确认。

### 空分组

允许保留，删除时仍需二次确认。

### 历史数据迁移

1. 为历史对话添加 userId
2. groupId 默认为 null（未分组）
3. order 按创建时间排序初始化
