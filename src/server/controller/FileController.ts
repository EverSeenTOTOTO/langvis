import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import path from 'path';
import mime from 'mime-types';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { FileService } from '../service/FileService';

@singleton()
@controller('/api/files')
export class FileController {
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
  async downloadFile(req: Request, res: Response) {
    const filename = req.params[0];

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Get file stats first to check if file exists and get metadata
    const fileStats = await this.fileService.getFileStats(filename);

    if (!fileStats) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get file buffer
    const fileBuffer = await this.fileService.downloadFile(filename);

    if (!fileBuffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers for download (force attachment)
    const mimeType = mime.lookup(filename) || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileStats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

    return res.send(fileBuffer);
  }

  @api('/play/*', { method: 'get' })
  async playFile(req: Request, res: Response) {
    const filename = req.params[0];

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Check if file extension is allowed for inline viewing
    const ext = path.extname(filename).toLowerCase();
    const allowedExtensions = this.getInlineExtensions();

    if (!allowedExtensions.includes(ext)) {
      return res.status(403).json({
        error: 'File type not allowed for inline viewing',
        allowedExtensions,
      });
    }

    // Get file stats first to check if file exists and get metadata
    const fileStats = await this.fileService.getFileStats(filename);

    if (!fileStats) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get file buffer
    const fileBuffer = await this.fileService.downloadFile(filename);

    if (!fileBuffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers for inline viewing/playing
    const mimeType = mime.lookup(filename) || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileStats.size);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

    // Add cache control for better performance
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('ETag', `"${fileStats.mtime.getTime()}-${fileStats.size}"`);

    // Add Accept-Ranges header for files that support range requests
    const rangeExtensions = this.getRangeExtensions();
    if (rangeExtensions.includes(ext)) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    return res.send(fileBuffer);
  }

  @api('/info/*', { method: 'get' })
  async getFileInfo(req: Request, res: Response) {
    const filename = req.params[0];

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

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
  }
}
