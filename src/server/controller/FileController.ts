import type { Request, Response } from 'express';
import mime from 'mime-types';
import path from 'path';
import { container, inject } from 'tsyringe';
import { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import {
  file as fileParam,
  param,
  query as queryParam,
  request,
  response,
} from '../decorator/param';
import { FileService } from '../service/FileService';
import type { UploadConfig } from '@/shared/types';
import Logger from '../utils/logger';

@controller('/api/files')
export default class FileController {
  private readonly logger = Logger.child({ source: 'FileController' });

  constructor(@inject(FileService) private fileService: FileService) {}

  private getInlineExtensions(): string[] {
    const extensions = process.env.FILE_INLINE_EXTENSIONS || '';
    return extensions
      .split(',')
      .map(ext => ext.trim().toLowerCase())
      .filter(Boolean);
  }

  private getRangeExtensions(): string[] {
    const extensions = process.env.FILE_RANGE_EXTENSIONS || '';
    return extensions
      .split(',')
      .map(ext => ext.trim().toLowerCase())
      .filter(Boolean);
  }

  @api('/download/*', { method: 'get' })
  async downloadFile(
    @param('0') filename: string,
    @request() req: Request,
    @response() res: Response,
  ): Promise<void> {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    try {
      // Get file stats first to check if file exists and get metadata
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const { size } = fileStats;

      // Parse range header if present
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

        if (start >= size || end >= size) {
          res.setHeader('Content-Range', `bytes */${size}`);
          res.status(416).json({ error: 'Range Not Satisfiable' });
          return;
        }

        const chunksize = end - start + 1;
        const stream = await this.fileService.createReadStream(filename, {
          start,
          end,
        });

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunksize);
        res.setHeader('Content-Type', mimeType);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`,
        );
        res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

        stream.pipe(res);
      } else {
        // Full file download
        const stream = await this.fileService.createReadStream(filename);

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', size);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`,
        );
        res.setHeader('Last-Modified', fileStats.mtime.toUTCString());
        res.setHeader('Accept-Ranges', 'bytes');

        stream.pipe(res);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'File not found') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      this.logger.error('Error in downloadFile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  @api('/play/*', { method: 'get' })
  async playFile(
    @param('0') filename: string,
    @request() req: Request,
    @response() res: Response,
  ): Promise<void> {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    // Check if file extension is allowed for inline viewing
    const ext = path.extname(filename).toLowerCase();
    const allowedExtensions = this.getInlineExtensions();

    if (!allowedExtensions.includes(ext)) {
      res.status(403).json({
        error: 'File type not allowed for inline viewing',
        allowedExtensions,
      });
      return;
    }

    try {
      // Get file stats first to check if file exists and get metadata
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const { size } = fileStats;
      const rangeExtensions = this.getRangeExtensions();

      // Add cache control for better performance
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('ETag', `"${fileStats.mtime.getTime()}-${fileStats.size}"`);
      res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

      // Handle Range requests for media files
      const range = req.headers.range;
      if (range && rangeExtensions.includes(ext)) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

        if (start >= size || end >= size) {
          res.setHeader('Content-Range', `bytes */${size}`);
          res.status(416).json({ error: 'Range Not Satisfiable' });
          return;
        }

        const chunksize = end - start + 1;
        const stream = await this.fileService.createReadStream(filename, {
          start,
          end,
        });

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunksize);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        stream.pipe(res);
      } else {
        // Full file streaming
        const stream = await this.fileService.createReadStream(filename);

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', size);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        // Add Accept-Ranges header for files that support range requests
        if (rangeExtensions.includes(ext)) {
          res.setHeader('Accept-Ranges', 'bytes');
        }

        stream.pipe(res);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'File not found') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      this.logger.error('Error in playFile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  @api('/info/*', { method: 'get' })
  async getFileInfo(@param('0') filename: string, @response() res: Response) {
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    try {
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        return res.status(404).json({ error: 'File not found' });
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';

      return res.json({
        filename,
        size: fileStats.size,
        mtime: fileStats.mtime,
        mimeType,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'File not found') {
        return res.status(404).json({ error: 'File not found' });
      }
      this.logger.error('Error in getFileInfo:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getUploadConfig(agentToken?: string): UploadConfig {
    if (!agentToken) {
      return {
        maxSize: 10 * 1024 * 1024, // 10MB default
        allowedTypes: ['*'],
        maxCount: 1,
      };
    }

    try {
      const agent = container.resolve(agentToken) as Agent;
      return (
        (agent.config as any)?.upload || {
          maxSize: 10 * 1024 * 1024,
          allowedTypes: ['*'],
          maxCount: 1,
        }
      );
    } catch {
      return {
        maxSize: 10 * 1024 * 1024,
        allowedTypes: ['*'],
        maxCount: 1,
      };
    }
  }

  private validateFile(
    file: Express.Multer.File,
    config: UploadConfig,
  ): string | null {
    if (config.maxSize && file.size > config.maxSize) {
      return `File size ${file.size} exceeds limit: ${config.maxSize} bytes`;
    }

    if (config.allowedTypes && !config.allowedTypes.includes('*')) {
      const allowed = config.allowedTypes.some((type: string) => {
        if (type.endsWith('/*')) {
          return file.mimetype.startsWith(type.slice(0, -1));
        }
        return file.mimetype === type;
      });
      if (!allowed) {
        return `File type ${file.mimetype} not allowed. Allowed types: ${config.allowedTypes.join(', ')}`;
      }
    }

    return null;
  }

  @api('/upload', { method: 'post' })
  async uploadFile(
    @fileParam('file') file: Express.Multer.File,
    @response() res: Response,
    @queryParam() query?: { agent?: string },
  ): Promise<void> {
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const uploadConfig = this.getUploadConfig(query?.agent);
    const validationError = this.validateFile(file, uploadConfig);

    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    try {
      const result = await this.fileService.saveFile(file);
      res.json(result);
    } catch (error) {
      this.logger.error('Error in uploadFile:', error);
      res.status(500).json({ error: 'Failed to save file' });
    }
  }

  @api('/list')
  async listFiles(
    @queryParam() query: { page?: number; pageSize?: number },
    @response() res: Response,
  ): Promise<void> {
    try {
      const result = await this.fileService.listFiles({
        page: query.page || 1,
        pageSize: query.pageSize || 20,
      });
      res.json({
        ...result,
        page: query.page || 1,
        pageSize: query.pageSize || 20,
      });
    } catch (error) {
      this.logger.error('Error in listFiles:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  }

  @api('/:filename', { method: 'delete' })
  async deleteFile(
    @param('filename') filename: string,
    @response() res: Response,
  ): Promise<void> {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    try {
      await this.fileService.deleteFile(filename);
      res.json({ success: true });
    } catch (error) {
      this.logger.error('Error in deleteFile:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }
}
