# 对话分组与排序设计方案

## 一、需求概述

1. **分组功能**：对话必须归属分组，分组不支持嵌套，最多两级（分组 → 对话）
2. **排序功能**：分组可排序；分组内对话可排序
3. **删除功能**：删除分组时级联删除其下所有对话，需二次确认
4. **用户隔离**：对话和分组关联用户，实现数据隔离

## 二、数据结构

### 2.1 `ConversationGroup` 实体

```typescript
@Entity('conversation_groups')
export class ConversationGroupEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  order!: number; // 分组间排序

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

### 2.2 `Conversation` 实体

关键字段：

```typescript
@Column({ type: 'uuid' })
groupId!: string; // 必须属于某个分组

@Column({ type: 'int', default: 0 })
order!: number; // 组内排序

@Column({ type: 'uuid' })
userId!: string;

@ManyToOne(() => UserEntity)
user!: UserEntity;

@ManyToOne(() => ConversationGroupEntity, group => group.conversations)
group!: ConversationGroupEntity;
```

### 2.3 排序策略

使用 `order` 整数字段，数值越小越靠前，初始值为创建时同层级最大 order + 100。

**层级说明**：

- **第一层**：分组排序
- **第二层**：分组内的对话排序

## 三、特殊分组：Ungrouped

### 3.1 概念

`Ungrouped` 是一个**固定名称**的特殊分组，用于存放"未分组"的对话。

```typescript
export const UNGROUPED_GROUP_NAME = 'Ungrouped';
```

### 3.2 特性

- **自动创建**：当用户首次创建对话且未指定分组时，系统自动创建名为 `Ungrouped` 的分组
- **常规分组**：在数据结构上，它与普通分组完全一致，只是名称固定为 `"Ungrouped"`
- **用户隔离**：每个用户都有自己独立的 `Ungrouped` 分组

### 3.3 行为规则

| 场景                        | 行为                                              |
| --------------------------- | ------------------------------------------------- |
| 创建对话，未指定 groupId    | 自动分配到用户的 `Ungrouped` 分组（不存在则创建） |
| 更新对话，groupId 设为 null | 自动分配到 `Ungrouped` 分组                       |
| 创建对话，指定 groupName    | 查找或创建该名称的分组                            |
| 删除 `Ungrouped` 分组       | 与删除普通分组一致，级联删除其下所有对话          |

## 四、API 设计

### 4.1 分组 API

| 方法   | 路径                                            | 说明                       |
| ------ | ----------------------------------------------- | -------------------------- |
| POST   | `/api/conversation-group`                       | 创建分组                   |
| GET    | `/api/conversation-group`                       | 获取当前用户所有分组及对话 |
| PUT    | `/api/conversation-group/:id`                   | 编辑分组名称               |
| DELETE | `/api/conversation-group/:id`                   | 删除分组（级联删除对话）   |
| POST   | `/api/conversation-group/reorder`               | 分组排序                   |
| POST   | `/api/conversation-group/reorder-conversations` | 组内对话排序               |

### 4.2 对话 API

| 方法   | 路径                    | 说明         |
| ------ | ----------------------- | ------------ |
| POST   | `/api/conversation`     | 创建对话     |
| GET    | `/api/conversation`     | 获取对话列表 |
| PUT    | `/api/conversation/:id` | 编辑对话     |
| DELETE | `/api/conversation/:id` | 删除对话     |

### 4.3 关键 API 定义

#### 创建对话

```typescript
// POST /api/conversation
{
  name: string;
  config?: { agent: string; [key: string]: any };
  groupId?: string;   // 可选，不传则分配到 Ungrouped 分组
  groupName?: string; // 可选，按名称查找或创建分组
}
```

#### 获取分组列表

```typescript
// GET /api/conversation-group
{
  groups: Array<{
    id: string;
    name: string;
    order: number;
    conversations: Conversation[];
  }>;
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

#### 排序 API

```typescript
// POST /api/conversation-group/reorder
// 分组排序
{
  items: Array<{ id: string; type: 'group'; order: number }>;
}

// POST /api/conversation-group/reorder-conversations
// 组内对话排序
{
  groupId: string;
  items: Array<{ id: string; order: number }>;
}
```

## 五、前端交互

### 5.1 组件方案

使用 ant-design `Tree` 组件。

### 5.2 Tree 结构示例

```
├── Ungrouped (order: 100)
│   ├── 对话A (order: 100)
│   └── 对话B (order: 200)
├── 分组X (order: 200)
│   └── 对话1 (order: 100)
└── 分组Y (order: 300)
    ├── 对话2 (order: 100)
    └── 对话3 (order: 200)
```

### 5.3 节点交互

**分组节点**

- 左侧：折叠/展开箭头
- 右侧：「...」菜单 →【编辑分组】、【删除分组】
- 拖拽：支持分组间排序

**对话节点**

- 左侧：对话图标
- 右侧：「...」菜单 →【编辑对话】
- 拖拽：支持组内排序

### 5.4 新建对话

- 位置：对话列表末尾，「New Conversation」按钮
- 弹窗表单：
  - 名称（必填）
  - 分组（下拉选择已有分组，默认为 `Ungrouped`）
  - Agent 配置

### 5.5 编辑弹窗

- 对话：沿用现有 `ConversationModal`
- 分组：弹窗，仅 name 字段

## 六、特殊规则

### 删除分组

级联删除该分组下所有对话，需二次确认。

### 空分组

允许保留，删除时仍需二次确认。
