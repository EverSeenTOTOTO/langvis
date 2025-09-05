import {
  DropdownProps as AntdDropdownProps,
  Button,
  ButtonProps,
  Divider,
  DividerProps,
  Dropdown,
  Space,
} from 'antd';
import { omit } from 'lodash-es';
import { useMergedState } from 'rc-util';
import React from 'react';
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
    });

export type DropdownProps = Omit<AntdDropdownProps, 'menu'> & {
  items: DropdownMenuItem[];
};

const DropdownMenu = ({ items, ...props }: DropdownProps) => {
  const [open, setOpen] = useMergedState(false, {
    onChange: open => props.onOpenChange?.(open, { source: 'menu' }),
  });

  return (
    <Dropdown
      {...props}
      open={open}
      onOpenChange={open => setOpen(open)}
      popupRender={() => (
        <Space direction="vertical" size="small" className="dropdownmenu">
          {items?.map(item => {
            if (item.type === 'divider') {
              return <Divider {...omit(item, 'type', 'key')} key={item.key} />;
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
      )}
    />
  );
};

export default DropdownMenu;
