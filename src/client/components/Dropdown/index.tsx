import { RightOutlined } from '@ant-design/icons';
import {
  DropdownProps as AntdDropdownProps,
  Button,
  ButtonProps,
  Divider,
  DividerProps,
  Dropdown,
  Popover,
  Space,
} from 'antd';
import { omit } from 'lodash-es';
import { useMergedState } from 'rc-util';
import React, { useCallback } from 'react';
import { Fragment } from 'react/jsx-runtime';
import './index.scss';

export type DropdownMenuItem =
  | (Omit<DividerProps, 'type'> & {
      key: string;
      label?: React.ReactNode;
      type: 'divider';
    })
  | (Omit<ButtonProps, 'type' | 'children'> & {
      key: string;
      label?: React.ReactNode;
      children?: DropdownMenuItem[];
      type: 'item';
      render?({
        item,
        dom,
        setOpen,
      }: {
        item: DropdownMenuItem;
        dom: React.ReactNode;
        setOpen: (open: boolean) => void;
      }): React.ReactNode;
    })
  | {
      key: string;
      type: 'submenu';
      icon?: React.ReactNode;
      label?: React.ReactNode;
      children: DropdownMenuItem[];
    };

export type DropdownProps = Omit<AntdDropdownProps, 'menu'> & {
  items: DropdownMenuItem[];
};

const DropdownMenu = ({ items, ...props }: DropdownProps) => {
  const [open, setOpen] = useMergedState(false, {
    onChange: open => props.onOpenChange?.(open, { source: 'menu' }),
  });

  const renderItems = useCallback(
    (items: DropdownMenuItem[]) => {
      return (
        <Space direction="vertical" size="small" className="dropdownmenu">
          {items?.map(item => {
            if (item.type === 'divider') {
              return <Divider {...omit(item, 'type', 'key')} key={item.key} />;
            }

            if (item.type === 'submenu') {
              return (
                <Popover
                  key={item.key}
                  content={renderItems(item.children)}
                  trigger="hover"
                  placement="right"
                  styles={{
                    body: { paddingBlock: 4, paddingInline: 0 },
                  }}
                >
                  <Button icon={item.icon} type="text">
                    {item.label}
                    <RightOutlined style={{ marginBlockStart: 2 }} />
                  </Button>
                </Popover>
              );
            }

            const { render, key, ...btnProps } = item;
            const dom = (
              <Button
                {...btnProps}
                type="text"
                onClick={e => {
                  btnProps?.onClick?.(e);
                  setOpen(false);
                }}
              >
                {item.label}
              </Button>
            );

            return (
              <Fragment key={key}>
                {render ? render({ item, dom, setOpen }) : dom}
              </Fragment>
            );
          })}
        </Space>
      );
    },
    [setOpen],
  );

  return (
    <Dropdown
      {...props}
      open={open}
      onOpenChange={open => setOpen(open)}
      popupRender={() => renderItems(items)}
    />
  );
};

export default DropdownMenu;

