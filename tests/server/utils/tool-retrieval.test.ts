import { describe, it, expect } from 'vitest';
import { tokenizeQuery, matchFilter } from '@/server/utils/tool-retrieval';

describe('tokenizeQuery', () => {
  it('保留整个空白 token（向后兼容）', () => {
    const kw = tokenizeQuery('帮我处理pdf文件');
    expect(kw).toContain('帮我处理pdf文件');
  });

  it('拉丁/数字段整段保留（保住工具 id 命中）', () => {
    const kw = tokenizeQuery('帮我处理pdf文件');
    expect(kw).toContain('pdf');
    // 拉丁段在 _ 处断开(既有 SEGMENT_RE 行为)，但 document/archive 子串仍可命中
    const kw2 = tokenizeQuery('调用 /document_archive');
    expect(kw2).toContain('document');
    expect(kw2).toContain('archive');
  });

  it('CJK 段用 Segmenter 切真词，丢单字虚词', () => {
    const kw = tokenizeQuery('帮我处理文件');
    // 真词保留
    expect(kw).toContain('处理');
    expect(kw).toContain('文件');
    // 单字虚词不再作为独立关键词（过匹配源）
    expect(kw).not.toContain('帮');
    expect(kw).not.toContain('我');
  });

  it('未登录复合词不召回：Segmenter 只切已登录词', () => {
    // “语义检索”→语/义/检索；无 bigram 兜底，“语义”不再产词（召回取舍）
    const kw = tokenizeQuery('语义检索 文档归档');
    expect(kw).toContain('检索');
    expect(kw).toContain('归档');
    expect(kw).not.toContain('语义');
    expect(kw).not.toContain('文档');
  });

  it('纯英文走拉丁段', () => {
    const kw = tokenizeQuery('fetch web page');
    expect(kw).toContain('fetch');
    expect(kw).toContain('web');
    expect(kw).toContain('page');
  });

  it('空串无关键词', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('matchFilter', () => {
  it('无关键词时全放行', () => {
    expect(matchFilter(undefined, '任意文本')).toBe(true);
    expect(matchFilter([], '任意文本')).toBe(true);
  });

  it('CJK 真词子串命中', () => {
    const kw = tokenizeQuery('帮我检索文档');
    // 描述里含“检索”即命中
    expect(matchFilter(kw, 'Semantic search for document chunks')).toBe(false);
    expect(matchFilter(kw, '检索文档内容')).toBe(true);
  });

  it('拉丁段整词命中嵌入路径', () => {
    const kw = tokenizeQuery('处理pdf文件');
    expect(matchFilter(kw, 'Extract text from PDF files')).toBe(true);
  });
});
