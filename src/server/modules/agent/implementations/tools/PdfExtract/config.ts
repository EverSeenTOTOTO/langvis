import { ToolConfig } from '@/shared/types';
import { ToolIds } from '@/shared/constants';

export interface PdfExtractInput {
  path: string;
  pages?: string;
  maxCharsPerPage?: number;
}

export interface PdfFileResult {
  path: string;
  pages: number;
  extractedPages: string;
  charCount: number;
  text: string;
  truncated: boolean;
  warning?: string;
}

export interface PdfExtractOutput {
  files: PdfFileResult[];
  totalFiles: number;
  skipped: { path: string; reason: string }[];
}

export const config: ToolConfig<PdfExtractInput, PdfExtractOutput> = {
  name: 'pdf_extract',
  description:
    'Extract text from PDF files. Accepts an absolute path, a ~-prefixed path, a path relative to the workspace, or a glob pattern. All matched files must be .pdf. Text-layer PDFs are extracted via the built-in pdftotext; scanned/image-only PDFs yield no text and are flagged for OCR. Use `pages` to read a range (e.g. "1-5", "3,7,10", "1-") of large reports, and `maxCharsPerPage` to cap per-page size.',
  untrustedOutput: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'PDF file path or glob pattern. Absolute (~/Downloads/resume.pdf, /abs/file.pdf), ~-prefixed, or relative to the workspace directory. Glob wildcards (* ? []) are supported.',
      },
      pages: {
        type: 'string',
        nullable: true,
        description:
          'Optional page range to extract, e.g. "1-5", "3,7,10", "1-" (open-ended). Omit to extract all pages.',
      },
      maxCharsPerPage: {
        type: 'number',
        nullable: true,
        description:
          'Optional per-page character cap (default 20000). Pages exceeding it are truncated and flagged truncated=true, to bound output size on dense annual reports.',
      },
    },
    required: ['path'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'One entry per successfully extracted PDF.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Resolved absolute path.' },
            pages: {
              type: 'number',
              description: 'Total page count of the document.',
            },
            extractedPages: {
              type: 'string',
              description: 'Page range actually extracted.',
            },
            charCount: {
              type: 'number',
              description: 'Character count of the extracted text.',
            },
            text: {
              type: 'string',
              description:
                'Extracted text, framed with "--- Page N ---" headers.',
            },
            truncated: {
              type: 'boolean',
              description: 'True if any page hit the maxCharsPerPage cap.',
            },
            warning: {
              type: 'string',
              nullable: true,
              description: 'Non-fatal notice, e.g. suspected scanned PDF.',
            },
          },
          required: [
            'path',
            'pages',
            'extractedPages',
            'charCount',
            'text',
            'truncated',
          ],
        },
      },
      totalFiles: {
        type: 'number',
        description: 'Number of successfully extracted files.',
      },
      skipped: {
        type: 'array',
        description: 'Paths not extracted, with the reason.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['path', 'reason'],
        },
      },
    },
    required: ['files', 'totalFiles', 'skipped'],
  },
};

export const id = ToolIds.PDF_EXTRACT;
