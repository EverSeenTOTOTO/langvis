import {
  Button,
  ButtonProps,
  Divider,
  Popover,
  PopoverProps,
  Space,
} from 'antd';
import clsx from 'clsx';
import { Fragment } from 'react/jsx-runtime';

import './index.scss';

export type DropdownMenuItem = Omit<ButtonProps, 'type' | 'children'> & {
  key: string;
  label?: React.ReactNode;
  type?: 'divider' | 'group' | 'item';
  children?: DropdownMenuItem[];
  render?({
    item,
    dom,
  }: {
    item: DropdownMenuItem;
    dom: React.ReactNode;
  }): React.ReactNode;
};
export type DropdownProps = PopoverProps & {
  items: DropdownMenuItem[];
};

const DropdownMenu = ({ items, classNames, ...props }: DropdownProps) => {
  return (
    <Popover
      {...props}
      classNames={{
        ...classNames,
        root: clsx('dropdownmenu', classNames?.root),
      }}
      content={
        <>
          {items?.map(item => {
            if (item.type === 'divider') {
              const dom = <Divider key={item.key} />;

              return (
                <Fragment key={item.key}>
                  {item.render ? item.render({ item, dom }) : dom}
                </Fragment>
              );
            }

            if (item.type === 'group') {
              // TODO
              return null;
            }

            const { key, render, ...btnProps } = item;
            const dom = (
              <Space key={key}>
                <Button {...btnProps} type="text">
                  {item.label}
                </Button>
              </Space>
            );

            return (
              <Fragment key={item.key}>
                {render ? render({ item, dom }) : dom}
              </Fragment>
            );
          })}
        </>
      }
    />
  );
};

export default DropdownMenu;
