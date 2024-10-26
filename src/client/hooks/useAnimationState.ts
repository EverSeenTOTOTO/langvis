import React, { useEffect, useState } from 'react';

export default ({
  ref,
  animationType = 'animate',
}: {
  ref: React.RefObject<HTMLElement>;
  animationType?: 'animate' | 'transition';
}) => {
  const [state, setState] = useState<'open' | 'closed'>('open');

  useEffect(() => {
    if (!ref.current) return;

    setState('open');

    const animationEnd = () => {
      setState('closed');
    };
    const transitionEnd = () => {
      setState('closed');
    };

    if (animationType === 'animate') {
      ref.current?.addEventListener('animationend', animationEnd);
      return () => {
        ref.current?.removeEventListener('animationend', animationEnd);
      };
    }

    if (animationType === 'transition') {
      ref.current?.addEventListener('transitionend', transitionEnd);
      return () => {
        ref.current?.removeEventListener('transitionend', transitionEnd);
      };
    }

    return undefined;
  }, [animationType]);

  return {
    'data-state': state,
  };
};
