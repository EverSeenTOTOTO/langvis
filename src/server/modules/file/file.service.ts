import { createReadStream, promises as fs } from 'fs';
import mime from 'mime-types';
import path from 'path';
import { service } from '@/server/decorator/service';
import { resolveSafePath } from '@/server/utils/pathSafety';
import { DEFAULT_UPLOAD_CONFIG } from '@/shared/constants';

/** saveFile 校验失败时抛出；FileController 据此映射 400。 */
export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}

@service()
export class FileService {
  private readonly uploadDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'upload');
  }

  private validatePath(filename: string): string {
    return resolveSafePath(filename, this.uploadDir);
  }

  async downloadFile(filename: string): Promise<Buffer | null> {
    try {
      const filePath = this.validatePath(filename);
      await fs.access(filePath);
      const fileBuffer = await fs.readFile(filePath);
      return fileBuffer;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async createReadStream(
    filename: string,
    options?: { start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream> {
    const filePath = this.validatePath(filename);

    try {
      await fs.access(filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new Error('File not found');
      }
      throw error;
    }

    const stream = createReadStream(filePath, options);
    return stream;
  }

  async getFileStats(
    filename: string,
  ): Promise<{ size: number; mtime: Date } | null> {
    try {
      const filePath = this.validatePath(filename);
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  getFilePath(filename: string): string {
    return this.validatePath(filename);
  }

  /** 上传限额取自 shared 的 DEFAULT_UPLOAD_CONFIG（与 upload ConfigFragment、客户端 picker 同源）。 */
  private validateUpload(file: Express.Multer.File): void {
    if (
      DEFAULT_UPLOAD_CONFIG.maxSize &&
      file.size > DEFAULT_UPLOAD_CONFIG.maxSize
    ) {
      throw new FileValidationError(
        `File size ${file.size} exceeds limit: ${DEFAULT_UPLOAD_CONFIG.maxSize} bytes`,
      );
    }
    if (!DEFAULT_UPLOAD_CONFIG.allowedTypes.includes('*')) {
      const allowed = DEFAULT_UPLOAD_CONFIG.allowedTypes.some(
        (type: string) => {
          if (type.endsWith('/*')) {
            return file.mimetype.startsWith(type.slice(0, -1));
          }
          return file.mimetype === type;
        },
      );
      if (!allowed) {
        throw new FileValidationError(
          `File type ${file.mimetype} not allowed. Allowed types: ${DEFAULT_UPLOAD_CONFIG.allowedTypes.join(', ')}`,
        );
      }
    }
  }

  async saveFile(
    file: Express.Multer.File,
    dir?: string,
  ): Promise<{
    filename: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    this.validateUpload(file);
    const ext = path.extname(file.originalname) || '';
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const baseName = `${timestamp}-${random}${ext}`;
    const filename = dir ? `${dir}/${baseName}` : baseName;

    const filePath = this.getFilePath(filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    const publicUrl = process.env.PUBLIC_URL || '';
    const url = publicUrl
      ? `${publicUrl}/api/files/play/${filename}`
      : `/api/files/play/${filename}`;

    return {
      filename,
      url,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  async listFiles(options: {
    page: number;
    pageSize: number;
    dir?: string;
  }): Promise<{
    items: Array<{
      filename: string;
      size: number;
      mimeType: string;
      createdAt: Date;
      url: string;
      isDir?: boolean;
    }>;
    total: number;
  }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const targetDir = options.dir
      ? path.join(this.uploadDir, options.dir)
      : this.uploadDir;

    const resolvedDir = path.resolve(targetDir);
    const resolvedUploadDir = path.resolve(this.uploadDir);

    if (!resolvedDir.startsWith(resolvedUploadDir)) {
      throw new Error(`Invalid directory path: ${targetDir}`);
    }

    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    const visibleEntries = entries.filter(e => !e.name.startsWith('.'));

    const dirs = visibleEntries
      .filter(e => e.isDirectory())
      .map(e => ({
        filename: e.name,
        size: 0,
        mimeType: '',
        createdAt: new Date(0),
        url: '',
        isDir: true,
      }));

    const files = await Promise.all(
      visibleEntries
        .filter(e => e.isFile())
        .map(async e => {
          const fullPath = path.join(resolvedDir, e.name);
          const stats = await fs.stat(fullPath);
          const relativePath = options.dir
            ? `${options.dir}/${e.name}`
            : e.name;
          return {
            filename: e.name,
            size: stats.size,
            mimeType: mime.lookup(e.name) || 'application/octet-stream',
            createdAt: stats.mtime,
            url: `/api/files/download/${relativePath}`,
          };
        }),
    );

    files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    dirs.sort((a, b) => a.filename.localeCompare(b.filename));

    const items = [...dirs, ...files];

    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return {
      items: paged,
      total: items.length,
    };
  }

  async deleteFile(filename: string): Promise<void> {
    const filePath = this.validatePath(filename);
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
  }
}
