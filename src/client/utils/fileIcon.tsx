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

export const getFileIcon = (mimeType: string): React.ReactNode => {
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
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

export const getFileColor = (mimeType: string): string => {
  const type = mimeType.toLowerCase();

  if (type.startsWith('image/')) return '#52c41a';
  if (type === 'application/pdf') return '#f5222d';
  if (type.includes('word') || type.includes('document')) return '#1890ff';
  if (type.includes('excel') || type.includes('spreadsheet')) return '#52c41a';
  if (type.includes('powerpoint') || type.includes('presentation')) {
    return '#fa8c16';
  }
  if (type.includes('zip') || type.includes('compressed')) return '#722ed1';
  if (type.startsWith('text/')) return '#595959';

  return '#8c8c8c';
};
