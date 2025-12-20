import {
  ColProps,
  FormItemProps,
  InputProps,
  RadioGroupProps,
  SelectProps,
  SwitchProps,
} from 'antd';
import { CheckboxGroupProps } from 'antd/es/checkbox';
import { InputNumberProps } from 'antd/lib';

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
  flex?: ColProps['flex'];
  span?: ColProps['span'];
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

export type NumberItem = CommonProps &
  Pick<
    InputNumberProps,
    | 'controls'
    | 'disabled'
    | 'max'
    | 'min'
    | 'precision'
    | 'step'
    | 'stringMode'
  > & {
    type: 'number';
  };

export type SwitchItem = CommonProps &
  Pick<SwitchProps, 'disabled' | 'checkedChildren' | 'unCheckedChildren'> & {
    type: 'switch';
  };

export type GroupItem = {
  label: string;
  name: string | string[];
  type: 'group';
  children: AgentConfigItem[];
  flex?: ColProps['flex'];
  span?: ColProps['span'];
};

export type AgentConfigItem =
  | SelectItem
  | TextItem
  | CheckboxGroupItem
  | RadioGroupItem
  | SwitchItem
  | NumberItem
  | GroupItem;

export type AgentFormItem = AgentConfigItem extends infer Each
  ? Each extends GroupItem
    ? never
    : Each
  : never;
