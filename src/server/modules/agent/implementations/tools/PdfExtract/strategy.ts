import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const PDF_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS_PER_PAGE = 20_000;

export interface ExtractRequest {
  pages?: string;
  maxCharsPerPage?: number;
}

export interface ExtractResult {
  pages: number;
  extractedPages: string;
  charCount: number;
  text: string;
  truncated: boolean;
  warning?: string;
}

export interface PdfExtractStrategy {
  extract(filePath: string, req: ExtractRequest): Promise<ExtractResult>;
}

/**
 * pdftotext 策略：处理真实文本层 PDF。
 * - pdfinfo 取页数；
 * - 全文为空 → 判定疑似扫描件，置 warning（OCR 策略的接入点）；
 * - pdftotext -layout 提取（保留财报表格对齐），按 \f 分页；
 * - 每页套 maxCharsPerPage 截断，重组 "--- Page N ---" 分页文本。
 */
export class PdftotextStrategy implements PdfExtractStrategy {
  async extract(filePath: string, req: ExtractRequest): Promise<ExtractResult> {
    const pages = await getPageCount(filePath);
    const maxCharsPerPage = req.maxCharsPerPage ?? DEFAULT_MAX_CHARS_PER_PAGE;

    const { first, last, extractedPages } = resolvePageRange(req.pages, pages);

    const raw = await runPdftotext(filePath, first, last);

    const trimmed = raw.trim();
    if (!trimmed) {
      return {
        pages,
        extractedPages,
        charCount: 0,
        text: '',
        truncated: false,
        warning:
          'No text layer extracted — suspected scanned/image-only PDF. OCR is not yet integrated.',
      };
    }

    const pageTexts = trimmed.split('\f');
    const framed: string[] = [];
    let truncated = false;
    const startPage = first ?? 1;

    for (let i = 0; i < pageTexts.length; i++) {
      const page = pageTexts[i]!.replace(/\r\n/g, '\n');
      if (page.length > maxCharsPerPage) {
        truncated = true;
        framed.push(
          `--- Page ${startPage + i} --- (truncated to ${maxCharsPerPage} chars)\n${page.slice(0, maxCharsPerPage)}\n…[truncated]`,
        );
      } else {
        framed.push(`--- Page ${startPage + i} ---\n${page}`);
      }
    }

    const text = framed.join('\n\n');
    return {
      pages,
      extractedPages,
      charCount: text.length,
      text,
      truncated,
    };
  }
}

/** 工厂：当前恒返回 pdftotext；后续 OCR 在此分派（如文本层为空时切 OcrStrategy）。 */
export function selectStrategy(): PdfExtractStrategy {
  return new PdftotextStrategy();
}

async function getPageCount(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFile('pdfinfo', [filePath], {
      timeout: PDF_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

async function runPdftotext(
  filePath: string,
  first: number | undefined,
  last: number | undefined,
): Promise<string> {
  const args = ['-layout'];
  if (first) args.push('-f', String(first));
  if (last) args.push('-l', String(last));
  args.push(filePath, '-');
  const { stdout } = await execFile('pdftotext', args, {
    timeout: PDF_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

interface ParsedRange {
  first: number | undefined;
  last: number | undefined;
  extractedPages: string;
}

/** 解析 pages 入参（"1-5"/"3,7,10"/"1-"）为 pdftotext 的 -f/-l。逗号列表取最小/最大页构成区间。 */
function resolvePageRange(
  pages: string | undefined,
  total: number,
): ParsedRange {
  if (!pages?.trim()) {
    return {
      first: undefined,
      last: undefined,
      extractedPages: `1-${total || '?'}`,
    };
  }

  const nums: number[] = [];
  let openEnded = false;
  for (const part of pages.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const range = seg.match(/^(\d+)\s*-\s*(\d*)$/);
    if (range) {
      const a = Number(range[1]);
      if (range[2]) {
        const b = Number(range[2]);
        nums.push(a, b);
      } else {
        nums.push(a);
        openEnded = true;
      }
    } else if (/^\d+$/.test(seg)) {
      nums.push(Number(seg));
    }
  }

  if (nums.length === 0) {
    return {
      first: undefined,
      last: undefined,
      extractedPages: `1-${total || '?'}`,
    };
  }

  const first = Math.min(...nums);
  const last = openEnded ? total || undefined : Math.max(...nums);
  return { first, last, extractedPages: pages.trim() };
}
