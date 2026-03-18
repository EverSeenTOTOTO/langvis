import {
  FileExcelOutlined,
  FileGifOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
  FileZipOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import { useMemo } from 'react';

export const useFileIcon = () => {
  const { token } = theme.useToken();

  const colorMap = useMemo(
    () => ({
      image: token.colorSuccess,
      pdf: token.colorError,
      word: token.colorInfo,
      excel: token.colorSuccess,
      ppt: token.colorWarning,
      zip: token.colorPrimary,
      text: token.colorTextSecondary,
      default: token.colorTextQuaternary,
    }),
    [token],
  );

  const getCategory = (mimeType: string) => {
    const type = mimeType.toLowerCase();

    if (type.startsWith('image/')) return 'image';
    if (type === 'application/pdf') return 'pdf';
    if (type.includes('word') || type.includes('document')) return 'word';
    if (type.includes('excel') || type.includes('spreadsheet')) return 'excel';
    if (type.includes('powerpoint') || type.includes('presentation'))
      return 'ppt';
    if (type.includes('zip') || type.includes('compressed')) return 'zip';
    if (type.startsWith('text/')) return 'text';
    return 'default' as const;
  };

  const getFileIcon = (mimeType: string) => {
    const type = mimeType.toLowerCase();

    if (type.startsWith('image/')) {
      if (type === 'image/gif') return <FileGifOutlined />;
      return <FileImageOutlined />;
    }

    if (type === 'application/pdf') return <FilePdfOutlined />;

    if (
      type === 'application/msword' ||
      type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return <FileWordOutlined />;
    }

    if (
      type === 'application/vnd.ms-excel' ||
      type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return <FileExcelOutlined />;
    }

    if (
      type === 'application/vnd.ms-powerpoint' ||
      type ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      return <FilePptOutlined />;
    }

    if (type === 'application/zip' || type === 'application/x-zip-compressed') {
      return <FileZipOutlined />;
    }

    if (type === 'text/markdown' || type === 'text/x-markdown') {
      return <FileMarkdownOutlined />;
    }

    if (type.startsWith('text/')) return <FileTextOutlined />;

    return <FileUnknownOutlined />;
  };

  const getFileColor = (mimeType: string): string => {
    return colorMap[getCategory(mimeType)];
  };

  return { getFileIcon, getFileColor };
};
