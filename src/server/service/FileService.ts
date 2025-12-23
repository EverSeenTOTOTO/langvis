import { singleton } from 'tsyringe';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';

@singleton()
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
      throw new Error('Invalid filename');
    }

    const filePath = path.join(this.uploadDir, filename);

    // Security check: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(this.uploadDir);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      throw new Error('Invalid file path');
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
}
