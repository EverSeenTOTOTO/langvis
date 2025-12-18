import {
  FormItemProps,
  InputProps,
  RadioGroupProps,
  SelectProps,
  SwitchProps,
} from 'antd';
import { CheckboxGroupProps } from 'antd/es/checkbox';
import { CSSProperties } from 'react';

type CommonProps = Pick<
  FormItemProps,
  | 'name'
  | 'label'
  | 'hidden'
  | 'required'
  | 'initialValue'
  | 'tooltip'
  | 'valuePropName'
> & {
  flex?: CSSProperties['flex'];
};

export type SelectItem = CommonProps &
  Pick<SelectProps, 'mode' | 'options' | 'placeholder' | 'disabled'> & {
    type: 'select';
  };

export type TextItem = CommonProps &
  Pick<InputProps, 'placeholder' | 'showCount' | 'disabled'> & {
    type: 'text';
  };

export type CheckboxGroupItem = CommonProps &
  Pick<CheckboxGroupProps, 'options' | 'disabled'> & {
    type: 'checkbox-group';
  };

export type RadioGroupItem = CommonProps &
  Pick<RadioGroupProps, 'options' | 'disabled'> & {
    type: 'radio-group';
  };

export type SwitchItem = CommonProps &
  Pick<SwitchProps, 'disabled' | 'checkedChildren' | 'unCheckedChildren'> & {
    type: 'switch';
  };

export type AgentConfigItem =
  | SelectItem
  | TextItem
  | CheckboxGroupItem
  | RadioGroupItem
  | SwitchItem;
