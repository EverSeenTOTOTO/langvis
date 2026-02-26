import {
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

export type SchemaProperty = {
  type?: string;
  enum?: readonly string[];
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

  if (prop.enum) {
    return (
      <Form.Item key={fieldKey} {...commonProps}>
        <Select
          options={prop.enum.map(v => ({ label: v, value: v }))}
          placeholder={prop.description}
        />
      </Form.Item>
    );
  }

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

  if (prop.type === 'boolean') {
    return (
      <Form.Item key={fieldKey} {...commonProps} valuePropName="checked">
        <Switch />
      </Form.Item>
    );
  }

  if (prop.type === 'string') {
    const isLongText = (prop.maxLength ?? 0) > 100;
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
        {isLongText ? (
          <Input.TextArea rows={4} placeholder={prop.description} />
        ) : (
          <Input placeholder={prop.description} />
        )}
      </Form.Item>
    );
  }

  return (
    <Form.Item key={fieldKey} {...commonProps}>
      <Input placeholder={prop.description} />
    </Form.Item>
  );
};

export default SchemaField;
