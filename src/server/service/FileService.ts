import { createReadStream, promises as fs } from 'fs';
import mime from 'mime-types';
import path from 'path';
import { service } from '../decorator/service';

@service()
export class FileService {
  private readonly uploadDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'upload');
  }

  private validateFilename(filename: string): boolean {
    // Check for null, undefined, or empty filename
    if (!filename || typeof filename !== 'string') {
      return false;
    }

    // Check for null bytes and other control characters including tab
    if (
      filename.includes('\x00') ||
      filename.includes('\n') ||
      filename.includes('\r') ||
      filename.includes('\t')
    ) {
      return false;
    }

    // URL decode the filename to catch encoded path traversal attempts
    let decodedFilename: string;
    try {
      decodedFilename = decodeURIComponent(filename);
    } catch {
      // Invalid URL encoding, reject
      return false;
    }

    // Check for path traversal attempts in both original and decoded filename
    const normalizedFilename = path.normalize(filename);
    const normalizedDecoded = path.normalize(decodedFilename);

    const hasTraversal = (name: string) =>
      name.includes('..') || name.startsWith('/') || name.includes('\\');

    if (hasTraversal(normalizedFilename) || hasTraversal(normalizedDecoded)) {
      return false;
    }

    return true;
  }

  private validatePath(filename: string): string {
    if (!this.validateFilename(filename)) {
      throw new Error(`Invalid filename: ${filename}`);
    }

    const filePath = path.join(this.uploadDir, filename);

    // Security check: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(this.uploadDir);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    return filePath;
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

  async listFiles(options: { page: number; pageSize: number }): Promise<{
    items: Array<{
      filename: string;
      size: number;
      mimeType: string;
      createdAt: Date;
      url: string;
    }>;
    total: number;
  }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;

    const files = await fs.readdir(this.uploadDir);
    const items = await Promise.all(
      files
        .filter(f => !f.startsWith('.'))
        .map(async filename => {
          const filePath = this.getFilePath(filename);
          const stats = await fs.stat(filePath);
          return {
            filename,
            size: stats.size,
            mimeType: mime.lookup(filename) || 'application/octet-stream',
            createdAt: stats.mtime,
            url: `/api/files/download/${filename}`,
          };
        }),
    );

    // Sort by createdAt desc
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return {
      items: paged,
      total: items.length,
    };
  }

  async deleteFile(filename: string): Promise<void> {
    const filePath = this.getFilePath(filename);
    await fs.unlink(filePath);
  }
}
