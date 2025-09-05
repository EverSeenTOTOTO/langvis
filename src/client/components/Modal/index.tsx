import { useTrigger, UseTriggerProps } from '@/client/hooks/useTrigger';
import { Modal as AntdModal, ModalProps as AntdModalProps } from 'antd';
import { useMergedState } from 'rc-util';

export type ModalProps = Omit<AntdModalProps, 'onOk' | 'onCancel' | 'footer'> &
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

const Modal: React.FC<ModalProps> = ({
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
      <AntdModal
        {...props}
        open={innerOpen}
        onOk={submit}
        onCancel={cancel}
        footer={
          typeof footer === 'function' ? footer({ submit, cancel }) : footer
        }
      />
      {triggerElement}
    </>
  );
};
export default Modal;
