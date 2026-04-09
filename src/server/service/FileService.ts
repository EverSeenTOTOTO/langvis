import { createReadStream, promises as fs } from 'fs';
import mime from 'mime-types';
import path from 'path';
import { service } from '../decorator/service';
import { resolveSafePath } from '../utils/pathSafety';

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

      // Check if file exists
      await fs.access(filePath);

      // Read and return file buffer
      const fileBuffer = await fs.readFile(filePath);
      return fileBuffer;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null; // File not found
      }
      throw error;
    }
  }

  async createReadStream(
    filename: string,
    options?: { start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream> {
    const filePath = this.validatePath(filename);

    // Check if file exists first
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
        return null; // File not found
      }
      throw error;
    }
  }

  getFilePath(filename: string): string {
    return this.validatePath(filename);
  }

  async saveFile(file: Express.Multer.File): Promise<{
    filename: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    const ext = path.extname(file.originalname) || '';
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const filename = `${timestamp}-${random}${ext}`;

    const filePath = this.getFilePath(filename);
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
