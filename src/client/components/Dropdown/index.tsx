import {
  DropdownProps as AntdDropdownProps,
  Button,
  ButtonProps,
  Divider,
  DividerProps,
  Dropdown,
  Space,
} from 'antd';
import { Fragment } from 'react/jsx-runtime';

import { omit } from 'lodash-es';
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
      }: {
        item: DropdownMenuItem;
        dom: React.ReactNode;
      }): React.ReactNode;
    });

export type DropdownProps = Omit<AntdDropdownProps, 'menu'> & {
  items: DropdownMenuItem[];
};

const DropdownMenu = ({ items, ...props }: DropdownProps) => {
  return (
    <Dropdown
      {...props}
      dropdownRender={() => (
        <Space direction="vertical" size="small" className="dropdownmenu">
          {items?.map(item => {
            if (item.type === 'divider') {
              return (
                <Fragment key={item.key}>
                  <Divider {...omit(item, 'type')} />
                </Fragment>
              );
            }

            const { render, ...btnProps } = item;
            const dom = (
              <Button {...btnProps} type="text">
                {item.label}
              </Button>
            );

            return (
              <Fragment key={item.key}>
                {render ? render({ item, dom }) : dom}
              </Fragment>
            );
          })}
        </Space>
      )}
    />
  );
};

export default DropdownMenu;

