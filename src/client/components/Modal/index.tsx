import { useTrigger, UseTriggerProps } from '@/client/hooks/useTrigger';
import { Modal as AntdModal, ModalProps as AntdModalProps } from 'antd';
import { useMergedState } from 'rc-util';

export type ModalProps = Omit<AntdModalProps, 'onOk' | 'onCancel'> &
  Omit<UseTriggerProps, 'onOpenChange'> & {
    onOk?: (e: React.MouseEvent<HTMLElement>) => void | Promise<boolean>;
    onCancel?: (e: React.MouseEvent<HTMLElement>) => void | Promise<boolean>;
  };

const Modal: React.FC<ModalProps> = ({
  trigger,
  triggerActions,

  open,
  disabled,

  onOk,
  onCancel,
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

  return (
    <>
      <AntdModal
        open={innerOpen}
        onOk={async e => {
          if (onOk) {
            if ((await onOk(e)) === true) {
              setInnerOpen(false);
            }
          } else {
            setInnerOpen(false);
          }
        }}
        onCancel={async e => {
          if (onCancel) {
            if ((await onCancel(e)) === true) {
              setInnerOpen(false);
            }
          } else {
            setInnerOpen(false);
          }
        }}
        {...props}
      />
      {triggerElement}
    </>
  );
};
export default Modal;
