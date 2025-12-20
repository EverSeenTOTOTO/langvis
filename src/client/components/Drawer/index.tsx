import { useTrigger, UseTriggerProps } from '@/client/hooks/useTrigger';
import { Drawer as AntdDrawer, DrawerProps as AntdDrawerProps } from 'antd';
import { useMergedState } from 'rc-util';

export type DrawerProps = Omit<AntdDrawerProps, 'onClose' | 'footer'> &
  Omit<UseTriggerProps, 'onOpenChange'> & {
    onOk?: () => void | Promise<boolean>;
    onCancel?: () => void | Promise<boolean>;
    footer?:
      | React.ReactNode
      | (({
          submit,
          cancel,
        }: {
          submit: () => void;
          cancel: () => void;
        }) => React.ReactNode);
  };

const Drawer: React.FC<DrawerProps> = ({
  trigger,
  triggerActions,

  open,
  disabled,

  onOk,
  onCancel,
  footer,
  ...props
}) => {
  const [innerOpen, setInnerOpen] = useMergedState(false, {
    value: open,
  });
  const triggerElement = useTrigger({
    trigger,
    triggerActions,
    onOpenChange: setInnerOpen,
    disabled,
  });

  const submit = async () => {
    if (onOk) {
      if ((await onOk()) === true) {
        setInnerOpen(false);
      }
    } else {
      setInnerOpen(false);
    }
  };

  const cancel = async () => {
    if (onCancel) {
      if ((await onCancel()) === true) {
        setInnerOpen(false);
      }
    } else {
      setInnerOpen(false);
    }
  };

  return (
    <>
      <AntdDrawer
        {...props}
        open={innerOpen}
        onClose={cancel}
        footer={
          typeof footer === 'function' ? footer({ submit, cancel }) : footer
        }
      />
      {triggerElement}
    </>
  );
};
export default Drawer;
