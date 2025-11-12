import { Form, FormInstance, FormItemProps } from 'antd';
import { once } from 'lodash-es';
import React from 'react';

// InlineItem component allows embedding custom form controls within antd Form.Item

export type InlineItemProps<T = any> = Omit<FormItemProps, 'children'> & {
  children: (
    {
      value,
      onChange,
    }: {
      value?: T;
      onChange?: (value?: T) => void;
    },
    form: FormInstance,
  ) => React.ReactElement;
};

const Control = <T,>({
  value,
  onChange,
  children,
}: {
  value?: T;
  onChange?: (value?: T) => void;
  children: InlineItemProps<T>['children'];
}) => {
  const form = Form.useFormInstance();
  const formOnChange = once(onChange ?? (() => {}));
  const child = children({ value, onChange: formOnChange }, form);

  const mergedValue = child.props.value ?? value;
  const mergedOnChange = (val: T) => {
    child.props.onChange?.(val);
    formOnChange(val);
  };

  return React.cloneElement(child, {
    value: mergedValue,
    onChange: mergedOnChange,
  });
};

const InlineItem = <T,>(props: InlineItemProps<T>) => {
  return (
    <Form.Item {...props}>
      <Control<T>>{props.children}</Control>
    </Form.Item>
  );
};

export default InlineItem;
