import { Image } from 'antd';
import React from 'react';

interface FilePreviewProps {
  filename: string;
  url: string;
  open: boolean;
  onClose: () => void;
}

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
];

const PREVIEW_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.log',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
];

const isImage = (filename: string) =>
  IMAGE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));

const isPreviewable = (filename: string) =>
  PREVIEW_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));

const FilePreview: React.FC<FilePreviewProps> = ({
  filename,
  url,
  open,
  onClose,
}) => {
  if (!open) return null;

  const playUrl = url.replace('/api/files/download/', '/api/files/play/');

  if (isImage(filename)) {
    return (
      <Image
        style={{ display: 'none' }}
        preview={{
          visible: open,
          src: playUrl,
          onVisibleChange: vis => !vis && onClose(),
        }}
      />
    );
  }

  if (isPreviewable(filename)) {
    return (
      <Image
        style={{ display: 'none' }}
        preview={{
          visible: open,
          imageRender: () => (
            <iframe
              src={playUrl}
              style={{
                width: '80vw',
                height: '80vh',
                border: 'none',
                borderRadius: 8,
              }}
              title={filename}
            />
          ),
          onVisibleChange: vis => !vis && onClose(),
        }}
      />
    );
  }

  return null;
};

export { FilePreview, isImage, isPreviewable };
