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
  'hidden' | 'required' | 'initialValue' | 'valuePropName'
> & {
  label?: I18nText;
  description?: I18nText;
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
  type: 'group';
  children: Record<string, ConfigItem>;
  flex?: ColProps['flex'];
  span?: ColProps['span'];
};

export type ConfigItem =
  | SelectItem
  | TextItem
  | CheckboxGroupItem
  | RadioGroupItem
  | SwitchItem
  | NumberItem
  | GroupItem;

export type AtomicConfigItem = ConfigItem extends infer Each
  ? Each extends GroupItem
    ? never
    : Each
  : never;

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
  config?: Record<string, ConfigItem>;
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
  input?: Record<string, ConfigItem>;
  /** 输出配置 */
  output?: Record<string, ConfigItem>;
  /** 是否启用 */
  enabled?: boolean;
}

export type StreamChunk =
  | string
  | { content: string; meta?: Record<string, any> }
  | { content?: string; meta: Record<string, any> };

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
