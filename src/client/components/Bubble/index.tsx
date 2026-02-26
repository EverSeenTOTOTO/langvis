import { LoadingOutlined } from '@ant-design/icons';
import { Spin } from 'antd';
import clsx from 'clsx';
import React from 'react';
import './index.scss';

export interface BubbleProps {
  placement?: 'start' | 'end';
  avatar?: React.ReactNode;
  content?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  styles?: {
    content?: React.CSSProperties;
  };
  className?: string;
}

const Bubble: React.FC<BubbleProps> = ({
  placement = 'start',
  avatar,
  content,
  footer,
  loading = false,
  styles: customStyles,
  className,
}) => {
  const isEnd = placement === 'end';

  const renderAvatar = () => {
    if (!avatar) return null;
    return <div className="bubble-avatar">{avatar}</div>;
  };

  const renderContent = () => {
    return (
      <div className="bubble-body">
        <div
          className={clsx('bubble-content', {
            'bubble-content-end': isEnd,
            'bubble-content-loading': loading && !content,
          })}
          style={customStyles?.content}
        >
          {loading ? <Spin indicator={<LoadingOutlined spin />} /> : content}
        </div>
        {footer !== undefined && <div className="bubble-footer">{footer}</div>}
      </div>
    );
  };

  return (
    <div
      className={clsx('bubble', className, {
        'bubble-end': isEnd,
      })}
      aria-label="chat bubble"
    >
      {!isEnd && renderAvatar()}
      {renderContent()}
      {isEnd && renderAvatar()}
    </div>
  );
};

export default Bubble;
