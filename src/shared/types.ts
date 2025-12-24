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

/**
 * 多语言文本类型
 */
export interface I18nText {
  en: string;
  zh?: string;
  [locale: string]: string | undefined;
}

export type CommonProps = Pick<
  FormItemProps,
  'name' | 'hidden' | 'required' | 'initialValue' | 'valuePropName'
> & {
  label?: I18nText;
  tooltip?: I18nText;
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
  label: I18nText;
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

/**
 * Tool输入参数定义
 */
export interface ToolParameterConfig {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  default?: any;
  description?: I18nText;
  range?: string;
  options?: Array<{
    label: string;
    value: string | number;
  }>;
}

/**
 * Tool输入/输出配置
 */
export interface ToolIOConfig {
  description?: I18nText;
  parameters?: Record<string, ToolParameterConfig>;
}

/**
 * Agent配置接口
 */
export interface AgentConfig {
  extends?: string;
  /** 显示名称 */
  name: I18nText;
  /** 描述信息 */
  description: I18nText;
  /** 依赖的工具列表 */
  tools?: string[];
  /** 配置项定义 */
  configItems?: AgentConfigItem[];
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * Tool配置接口
 */
export interface ToolConfig {
  extends?: string;
  /** 显示名称 */
  name: I18nText;
  /** 描述信息 */
  description: I18nText;
  /** 输入配置 */
  input?: ToolIOConfig;
  /** 输出配置 */
  output?: ToolIOConfig;
  /** 是否启用 */
  enabled?: boolean;
}

export type StreamChunk =
  | string
  | {
      type: 'chunk';
      data: string;
    }
  | {
      type: 'meta';
      data: Record<string, any>;
    };

export type SSEMessage =
  | { type: 'heartbeat' }
  | { type: 'completion_error'; error: string }
  | {
      type: 'completion_delta';
      content?: string;
      meta?: Record<string, any>;
    }
  | {
      type: 'completion_done';
    };

export interface ConversationConfig {
  agent: string;
  [key: string]: any;
}
