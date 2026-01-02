import type { Request, Response } from 'express';
import mime from 'mime-types';
import path from 'path';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { FileService } from '../service/FileService';
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
  async downloadFile(req: Request, res: Response): Promise<void> {
    const filename = req.params[0];

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
  async playFile(req: Request, res: Response): Promise<void> {
    const filename = req.params[0];

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
  async getFileInfo(req: Request, res: Response) {
    const filename = req.params[0];

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
}
