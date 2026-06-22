import { useStore } from '@/client/store';
import {
  Checkbox,
  Collapse,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Switch,
} from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import React from 'react';
import ModelSelect from './ModelSelect';
import {
  applyReactions,
  collectFields,
  type EnumItem,
  type SchemaReaction,
} from './reactions';

export type { EnumItem } from './reactions';

export type SchemaProperty = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  /** JSON Schema standard enum, supports simple values or {label, value} objects */
  enum?: readonly EnumItem[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
  title?: string;
  properties?: Record<string, SchemaProperty>;
  /**
   * JSON Schema 语义（仅 object 用）：列出哪些子属性必填。
   * 注意：reaction 的 `set.required`（布尔，表示「本字段必填」）经 applyReactions
   * 合并后会以布尔形式出现在这里——故类型为两者之并，读取时按 typeof 区分。
   */
  required?: boolean | readonly string[];
  /** 反应式：本字段是否禁用（由 reaction 的 set.disabled 合入）。 */
  disabled?: boolean;
  /** 反应式：本字段是否渲染（由 reaction 的 set.visible 合入；false 时不渲染）。 */
  visible?: boolean;
  items?: SchemaProperty;
  /** Custom format hint: 'model-select' renders a TreeSelect with provider-grouped models */
  format?: string;
  /** For format='model-select': filter models by type (chat/embedding/tts) */
  modelType?: string;
  /**
   * 响应式联动规则：当 `when` 成立时，用 `set` 覆盖本字段的渲染状态
   * （visible/required/disabled/enum/title/description）。机制与写法见 ./reactions.ts。
   */
  reactions?: readonly SchemaReaction[];
};

/** Normalize enum items to { label, value } format */
function normalizeEnumItems(items: readonly EnumItem[]): {
  label: string;
  value: string | number | boolean;
}[] {
  return items.map(item => {
    if (
      typeof item === 'object' &&
      item !== null &&
      'label' in item &&
      'value' in item
    ) {
      return item as { label: string; value: string | number | boolean };
    }
    // Primitive value: use as both label and value
    return { label: String(item), value: item as string | number | boolean };
  });
}

/** Read a nested value out of a plain form-values object by NamePath. Used by the
 * reactive branch's `shouldUpdate` to diff prev/next snapshots at each peer path. */
function getAtPath(obj: unknown, path: NamePath): unknown {
  const keys = Array.isArray(path) ? path : [path];
  return keys.reduce<unknown>((acc, key) => {
    if (acc == null) return acc;
    return (acc as Record<string, unknown>)[key as string];
  }, obj);
}

interface SchemaFieldProps {
  name: NamePath;
  prop: SchemaProperty;
  required?: boolean;
  label?: string;
  namePrefix?: NamePath;
  grid?: boolean;
}

/**
 * 枚举收窄守卫：当 reaction 把 `enum` 收窄、而当前值已不在新选项内时，清空该字段值。
 * 避免提交「值不属于当前可选选项」的脏配置（如选了 slide_window_memory 后切到只支持
 * react_memory 的 agent）。在 effect 中 setFieldValue（避免渲染期副作用）；enum 未变或当前值
 * 仍合法时不动作。`name` 对给定 fieldKey 稳定，故以 fieldKey + 枚举签名 为依赖。
 */
const ReactiveEnumGuard: React.FC<{
  name: NamePath;
  fieldKey: string;
  enumItems: readonly EnumItem[];
  children: React.ReactNode;
}> = ({ name, fieldKey, enumItems, children }) => {
  const form = Form.useFormInstance();
  const sig = JSON.stringify(enumItems);
  React.useEffect(() => {
    const values = normalizeEnumItems(enumItems).map(o => o.value);
    const current = form.getFieldValue(name);
    if (
      current !== undefined &&
      current !== null &&
      !values.some(v => v === current)
    ) {
      form.setFieldValue(name, undefined);
    }
  }, [form, fieldKey, sig]);
  return <>{children}</>;
};

const SchemaField: React.FC<SchemaFieldProps> = ({
  name,
  prop,
  required = false,
  label,
  namePrefix,
  grid = false,
}) => {
  const settingStore = useStore('setting');
  const form = Form.useFormInstance();

  // peer 字段路径相对 schema 根（顶层 properties），由 namePrefix 锚定 →
  // 会话表单(prefix=['config']) 与 HumanInputForm(扁平) 共用同一套路径写法。
  const peerPath = (field: string): NamePath => [
    ...(Array.isArray(namePrefix)
      ? (namePrefix as readonly (string | number)[])
      : []),
    ...field.split('.'),
  ];

  // 渲染合并后的 effective property。捕获 name/namePrefix/grid 等上下文；
  // 所有分支读 effective（而非原始 prop），使 reaction 的 set 能即时生效。
  const renderField = (effective: SchemaProperty): React.ReactNode => {
    const fieldLabel =
      label ??
      effective.title ??
      (Array.isArray(name) ? name[name.length - 1] : name);
    const fullName: NamePath = namePrefix ? [...namePrefix, name].flat() : name;
    const fieldKey = JSON.stringify(name);
    // reaction 的 set.required（布尔）覆盖静态 required；JSON Schema 的 required
    // 数组与此无关（仅 object 分支用），故按 typeof 区分。
    const isRequired =
      typeof effective.required === 'boolean' ? effective.required : required;
    const disabled = effective.disabled === true;

    const commonProps = {
      name: fullName,
      label: fieldLabel,
      initialValue: effective.default,
      tooltip: effective.description,
      rules: [{ required: isRequired }],
    };

    // Object type: render nested properties
    if (effective.type === 'object' && effective.properties) {
      const requiredSet = new Set(
        Array.isArray(effective.required) ? effective.required : [],
      );
      const children = Object.entries(effective.properties).map(
        ([key, child]) => (
          <SchemaField
            key={key}
            name={[name, key].flat()}
            prop={child}
            required={requiredSet.has(key)}
            namePrefix={namePrefix}
            grid={grid}
          />
        ),
      );

      return (
        <Collapse
          key={fieldKey}
          size="small"
          bordered={false}
          defaultActiveKey="1"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: '1',
              label: fieldLabel,
              children: grid ? (
                <Row gutter={12}>
                  {Object.entries(effective.properties).map(([key, child]) => (
                    <Col span={12} key={key}>
                      <SchemaField
                        name={[name, key].flat()}
                        prop={child}
                        required={requiredSet.has(key)}
                        namePrefix={namePrefix}
                        grid={grid}
                      />
                    </Col>
                  ))}
                </Row>
              ) : (
                children
              ),
            },
          ]}
        />
      );
    }

    // Array type with enum: multi-select checkboxes (vertical layout)
    if (effective.type === 'array' && effective.enum?.length) {
      const options = normalizeEnumItems(effective.enum);
      return (
        <Form.Item key={fieldKey} {...commonProps}>
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            disabled={disabled}
          >
            {options.map(opt => (
              <Checkbox
                key={String(opt.value)}
                value={opt.value}
                disabled={disabled}
              >
                {opt.label}
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>
      );
    }

    // Array type with object items: render each item as nested field
    if (effective.type === 'array' && effective.items?.type === 'object') {
      return (
        <Form.List key={fieldKey} name={fullName}>
          {fields => (
            <div>
              {fields.map(field => (
                <div key={field.key} style={{ marginBottom: 8 }}>
                  <SchemaField
                    name={[field.name]}
                    prop={effective.items!}
                    namePrefix={namePrefix}
                  />
                </div>
              ))}
            </div>
          )}
        </Form.List>
      );
    }

    // Array type fallback: comma-separated text input
    if (effective.type === 'array') {
      return (
        <Form.Item key={fieldKey} {...commonProps}>
          <Input
            placeholder={
              effective.description ?? settingStore.tr('Comma-separated values')
            }
            disabled={disabled}
          />
        </Form.Item>
      );
    }

    // Custom format: model-select renders TreeSelect.
    // 选中模型时把 multimodal 写到与 modelId 同级的兄弟字段（parent 下的 'multimodal'），
    // 供其它字段的 reaction 读取（如 upload 在 model.multimodal=false 时隐藏）。
    // ModelSelect 只报选中模型对象，写哪个路径由这里（知道 name）决定。
    if (effective.format === 'model-select') {
      const parent = (Array.isArray(fullName) ? fullName : [fullName]).slice(
        0,
        -1,
      );
      return (
        <Form.Item key={fieldKey} {...commonProps}>
          <ModelSelect
            modelType={effective.modelType}
            disabled={disabled}
            onModelSelect={m =>
              form.setFieldValue([...parent, 'multimodal'], m?.multimodal)
            }
          />
        </Form.Item>
      );
    }

    // String/number/integer with enum: single select
    if (
      effective.enum?.length &&
      (effective.type === 'string' ||
        effective.type === 'number' ||
        effective.type === 'integer' ||
        !effective.type)
    ) {
      const options = normalizeEnumItems(effective.enum);
      return (
        <Form.Item key={fieldKey} {...commonProps}>
          <Select
            options={options as { label: string; value: string | number }[]}
            placeholder={effective.description}
            disabled={disabled}
          />
        </Form.Item>
      );
    }

    // Number/integer type
    if (effective.type === 'number' || effective.type === 'integer') {
      return (
        <Form.Item key={fieldKey} {...commonProps}>
          <InputNumber
            min={effective.minimum}
            max={effective.maximum}
            style={{ width: '100%' }}
            placeholder={effective.description}
            precision={effective.type === 'integer' ? 0 : undefined}
            disabled={disabled}
          />
        </Form.Item>
      );
    }

    // Boolean type
    if (effective.type === 'boolean') {
      return (
        <Form.Item key={fieldKey} {...commonProps} valuePropName="checked">
          <Switch disabled={disabled} />
        </Form.Item>
      );
    }

    // String type (default)
    return (
      <Form.Item
        key={fieldKey}
        {...commonProps}
        rules={[
          { required: isRequired },
          ...(effective.minLength ? [{ min: effective.minLength }] : []),
          ...(effective.maxLength ? [{ max: effective.maxLength }] : []),
        ]}
      >
        <Input.TextArea
          rows={1}
          autoSize={{ minRows: 1, maxRows: 7 }}
          placeholder={effective.description}
          disabled={disabled}
        />
      </Form.Item>
    );
  };

  // 有 reactions：套响应式 Form.Item。用 `shouldUpdate`（而非 `dependencies`）触发重渲染：
  // dependencies 只在「已注册字段」变化时重渲染——而 model.multimodal 这类「衍生元信息」
  // 没有归属的 Form.Item，仅靠 setFieldValue 写入，对 dependencies 的路径匹配不可见，
  // 不会触发联动。shouldUpdate 对比整份 values 快照（prev vs next），能捕捉到这种 ghost peer。
  // `preserve={false}` 让被 visible:false 卸载的字段其值自动从 form store 丢弃，
  // 避免隐藏值被提交。无 reactions 时走原路径，行为零变化。
  if (prop.reactions?.length) {
    const depPaths = collectFields(prop.reactions).map(peerPath);
    const fullName: NamePath = namePrefix ? [...namePrefix, name].flat() : name;
    const fieldKey = JSON.stringify(name);
    return (
      <Form.Item
        noStyle
        preserve={false}
        shouldUpdate={(prev, next) =>
          depPaths.some(p => getAtPath(prev, p) !== getAtPath(next, p))
        }
      >
        {() => {
          const effective = applyReactions(prop, prop.reactions, f =>
            form.getFieldValue(peerPath(f)),
          );
          if (effective.visible === false) return null;
          const content = renderField(effective);
          // reaction 收窄了枚举 → 守卫清掉不再合法的旧值。
          if (!effective.enum?.length) return content;
          return (
            <ReactiveEnumGuard
              name={fullName}
              fieldKey={fieldKey}
              enumItems={effective.enum}
            >
              {content}
            </ReactiveEnumGuard>
          );
        }}
      </Form.Item>
    );
  }

  return <>{renderField(prop)}</>;
};

export default SchemaField;
