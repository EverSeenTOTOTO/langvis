import React from 'react';

export type UseTriggerProps = {
  trigger?: React.ReactElement;
  triggerActions?: ('click' | 'contextMenu' | 'hover')[];

  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
};

export const useTrigger = ({
  trigger,
  triggerActions,

  onOpenChange,
  disabled,
}: UseTriggerProps) => {
  const createEventHandlers = (props: any) => {
    const handlers: Record<string, (e: React.MouseEvent) => void> = {};
    const actions = triggerActions ?? ['click'];
    actions.forEach(action => {
      switch (action) {
        case 'click':
          handlers.onClick = async e => {
            if (disabled) return;
            await props?.onClick?.(e);
            onOpenChange?.(true);
          };
          break;
        case 'contextMenu':
          handlers.onContextMenu = async e => {
            if (disabled) return;
            await props?.onContextMenu?.(e);
            onOpenChange?.(true);
            e.preventDefault();
          };
          break;
        case 'hover':
          handlers.onMouseEnter = async e => {
            if (disabled) return;
            await props?.onMouseEnter?.(e);
            onOpenChange?.(true);
          };
          handlers.onPointerEnter = handlers.onMouseEnter;
          break;
        default:
          break;
      }
    });

    return handlers;
  };

  return React.useMemo(() => {
    if (!trigger) return null;

    const triggerElement = React.Children.only(trigger);

    return React.cloneElement(triggerElement, {
      ...triggerElement.props,
      ...createEventHandlers(triggerElement.props),
      disabled,
    });
  }, [trigger, disabled]);
};
