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
  // 仅 object 用：哪些子属性必填。reaction 的 set.required 合并后为布尔，读取时按 typeof 区分。
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
  // 响应式联动规则：when 成立时用 set 覆盖本字段渲染状态（visible/required/disabled/enum/title/description）。见 ./reactions.ts。
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

// Read a nested value from a form-values object by NamePath (for shouldUpdate diffing).
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

// 枚举收窄守卫：当前值不在新选项内时清空字段值，避免提交脏配置；在 effect 中 setFieldValue，依赖 fieldKey+枚举签名。
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

    // model-select 渲染 TreeSelect：选中时把 multimodal 写到与 modelId 同级的兄弟字段，供 reactions 联动读取。
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
        <Form.Item
          key={fieldKey}
          {...commonProps}
          normalize={v => (v == null ? undefined : v)}
        >
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

  // 有 reactions：用 shouldUpdate 而非 dependencies 重渲染——ghost peer 无归属 Form.Item，仅 setFieldValue 写入，
  // dependencies 对之不可见；preserve={false} 丢弃 visible:false 卸载值，避免隐藏值被提交。
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
