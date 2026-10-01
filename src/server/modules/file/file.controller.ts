/// <reference types="multer" />
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import mime from 'mime-types';
import path from 'node:path';
import { FileService, FileValidationError } from './file.service';
import { DEFAULT_UPLOAD_CONFIG } from '@/shared/constants';
import Logger from '@/server/utils/logger';
import { Public } from '@/server/guards/auth.guard';

@Controller('files')
export class FileController {
  private readonly logger = Logger.child({ source: 'FileController' });

  constructor(@Inject(FileService) private fileService: FileService) {}

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

  // 流式下载自持 res（Range/206/pipe），返回值语义不适用。
  @Public()
  @Get('download/{*splat}')
  async downloadFile(
    @Param('splat') filename: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    try {
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const { size } = fileStats;

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

  @Public()
  @Get('play/{*splat}')
  async playFile(
    @Param('splat') filename: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

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
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const { size } = fileStats;
      const rangeExtensions = this.getRangeExtensions();

      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('ETag', `"${fileStats.mtime.getTime()}-${fileStats.size}"`);
      res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

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
        const stream = await this.fileService.createReadStream(filename);

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', size);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

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

  @Get('info/{*splat}')
  async getFileInfo(@Param('splat') filename: string) {
    if (!filename) {
      throw new HttpException({ error: 'Filename is required' }, 400);
    }

    try {
      const fileStats = await this.fileService.getFileStats(filename);

      if (!fileStats) {
        throw new HttpException({ error: 'File not found' }, 404);
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';

      return {
        filename,
        size: fileStats.size,
        mtime: fileStats.mtime,
        mimeType,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'File not found') {
        throw new HttpException({ error: 'File not found' }, 404);
      }
      this.logger.error('Error in getFileInfo:', error);
      throw new HttpException({ error: 'Internal server error' }, 500);
    }
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DEFAULT_UPLOAD_CONFIG.maxSize },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() formBody: { dir?: string; agent?: string },
  ) {
    if (!file) {
      throw new HttpException({ error: 'No file uploaded' }, 400);
    }

    const dir = formBody?.dir;
    try {
      return await this.fileService.saveFile(file, dir);
    } catch (error) {
      if (error instanceof FileValidationError) {
        throw new HttpException({ error: error.message }, 400);
      }
      this.logger.error('Error in uploadFile:', error);
      throw new HttpException({ error: 'Failed to save file' }, 500);
    }
  }

  @Get('list')
  async listFiles(
    @Query() query: { page?: number; pageSize?: number; dir?: string },
  ) {
    try {
      const result = await this.fileService.listFiles({
        page: query.page || 1,
        pageSize: query.pageSize || 20,
        dir: query.dir,
      });
      return {
        ...result,
        page: query.page || 1,
        pageSize: query.pageSize || 20,
      };
    } catch (error) {
      this.logger.error('Error in listFiles:', error);
      throw new HttpException({ error: 'Failed to list files' }, 500);
    }
  }

  @Delete(':filename')
  async deleteFile(@Param('filename') filename: string) {
    if (!filename) {
      throw new HttpException({ error: 'Filename is required' }, 400);
    }

    try {
      await this.fileService.deleteFile(filename);
      return { success: true };
    } catch (error) {
      this.logger.error('Error in deleteFile:', error);
      throw new HttpException({ error: 'Failed to delete file' }, 500);
    }
  }
}
