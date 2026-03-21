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

/** Enum item can be a primitive value or an object with label/value */
export type EnumItem =
  | string
  | number
  | boolean
  | { label: string; value: string | number | boolean };

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
  required?: readonly string[];
  items?: SchemaProperty;
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

interface SchemaFieldProps {
  name: NamePath;
  prop: SchemaProperty;
  required?: boolean;
  label?: string;
  namePrefix?: NamePath;
  grid?: boolean;
}

const SchemaField: React.FC<SchemaFieldProps> = ({
  name,
  prop,
  required = false,
  label,
  namePrefix,
  grid = false,
}) => {
  const settingStore = useStore('setting');
  const fieldLabel =
    label ?? prop.title ?? (Array.isArray(name) ? name[name.length - 1] : name);
  const fullName: NamePath = namePrefix ? [...namePrefix, name].flat() : name;
  const fieldKey = JSON.stringify(name);

  const commonProps = {
    name: fullName,
    label: fieldLabel,
    initialValue: prop.default,
    tooltip: prop.description,
    rules: [{ required }],
  };

  // Object type: render nested properties
  if (prop.type === 'object' && prop.properties) {
    const requiredSet = new Set(prop.required ?? []);
    const children = Object.entries(prop.properties).map(([key, child]) => (
      <SchemaField
        key={key}
        name={[name, key].flat()}
        prop={child}
        required={requiredSet.has(key)}
        namePrefix={namePrefix}
        grid={grid}
      />
    ));

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
                {Object.entries(prop.properties).map(([key, child]) => (
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
  if (prop.type === 'array' && prop.enum?.length) {
    const options = normalizeEnumItems(prop.enum);
    return (
      <Form.Item key={fieldKey} {...commonProps}>
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {options.map(opt => (
            <Checkbox key={String(opt.value)} value={opt.value}>
              {opt.label}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </Form.Item>
    );
  }

  // Array type with object items: render each item as nested field
  if (prop.type === 'array' && prop.items?.type === 'object') {
    return (
      <Form.List key={fieldKey} name={fullName}>
        {fields => (
          <div>
            {fields.map(field => (
              <div key={field.key} style={{ marginBottom: 8 }}>
                <SchemaField
                  name={[field.name]}
                  prop={prop.items!}
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
  if (prop.type === 'array') {
    return (
      <Form.Item key={fieldKey} {...commonProps}>
        <Input
          placeholder={
            prop.description ?? settingStore.tr('Comma-separated values')
          }
        />
      </Form.Item>
    );
  }

  // String/number/integer with enum: single select
  if (
    prop.enum?.length &&
    (prop.type === 'string' ||
      prop.type === 'number' ||
      prop.type === 'integer' ||
      !prop.type)
  ) {
    const options = normalizeEnumItems(prop.enum);
    return (
      <Form.Item key={fieldKey} {...commonProps}>
        <Select
          options={options as { label: string; value: string | number }[]}
          placeholder={prop.description}
        />
      </Form.Item>
    );
  }

  // Number/integer type
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <Form.Item key={fieldKey} {...commonProps}>
        <InputNumber
          min={prop.minimum}
          max={prop.maximum}
          style={{ width: '100%' }}
          placeholder={prop.description}
          precision={prop.type === 'integer' ? 0 : undefined}
        />
      </Form.Item>
    );
  }

  // Boolean type
  if (prop.type === 'boolean') {
    return (
      <Form.Item key={fieldKey} {...commonProps} valuePropName="checked">
        <Switch />
      </Form.Item>
    );
  }

  // String type (default)
  return (
    <Form.Item
      key={fieldKey}
      {...commonProps}
      rules={[
        { required },
        ...(prop.minLength ? [{ min: prop.minLength }] : []),
        ...(prop.maxLength ? [{ max: prop.maxLength }] : []),
      ]}
    >
      <Input.TextArea
        rows={1}
        autoSize={{ minRows: 1, maxRows: 7 }}
        placeholder={prop.description}
      />
    </Form.Item>
  );
};

export default SchemaField;
