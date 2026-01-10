import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { Button, Flex } from 'antd';
import { useState } from 'react';
import { useCopyToClipboard } from 'react-use';

interface MessageFooterProps {
  content: string;
  children?: React.ReactNode;
}

const MessageFooter: React.FC<MessageFooterProps> = ({ content, children }) => {
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();

  const handleCopy = () => {
    copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Flex justify="end" className="message-footer" gap={4}>
      <Button
        color="default"
        variant="filled"
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={handleCopy}
        size="small"
      />
      {children}
    </Flex>
  );
};

export default MessageFooter;
