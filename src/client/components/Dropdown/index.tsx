import {
  Button,
  ButtonProps,
  Divider,
  Popover,
  PopoverProps,
  Space,
} from 'antd';
import clsx from 'clsx';

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

              return item.render ? item.render({ item, dom }) : dom;
            }

            if (item.type === 'group') {
              // TODO
              return null;
            }

            const dom = (
              <Space key={item.key}>
                <Button {...item} type="text">
                  {item.label}
                </Button>
              </Space>
            );

            return item.render ? item.render({ item, dom }) : dom;
          })}
        </>
      }
    />
  );
};

export default DropdownMenu;
