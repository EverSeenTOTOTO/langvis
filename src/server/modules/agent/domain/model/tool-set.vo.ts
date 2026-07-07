/**
 * - inline 成员 → schema 全文写进 system 提示（formatToolsToMarkdown）。
 * - listed 成员 → 仅 id 进提示的 "Other Tools and Skills" 列表。
 * - resolve 时仅允许集合内成员，越界由应用层抛 ToolNotFoundError。
 */
export type ToolMode = 'inline' | 'listed';

export interface ToolMember {
  id: string;
  mode: ToolMode;
}

export class ToolSet {
  private readonly members: readonly ToolMember[];
  private readonly skills: readonly string[];

  private constructor(
    members: readonly ToolMember[],
    skills: readonly string[],
  ) {
    this.members = members;
    this.skills = skills;
    Object.freeze(this);
  }

  static of(
    members: readonly ToolMember[],
    skills: readonly string[] = [],
  ): ToolSet {
    return new ToolSet([...members], [...skills]);
  }

  has(id: string): boolean {
    return this.members.some(m => m.id === id);
  }

  /** 全部成员 id（inline 在前、listed 在后，保持构造顺序）。 */
  memberIds(): string[] {
    return this.members.map(m => m.id);
  }

  /** inline 成员 id（保持构造顺序——提示里工具文档的排列序）。 */
  inlineIds(): string[] {
    return this.members.filter(m => m.mode === 'inline').map(m => m.id);
  }

  /** listed 成员 id（仅进 "Other Tools and Skills" 列表）。 */
  listedIds(): string[] {
    return this.members.filter(m => m.mode === 'listed').map(m => m.id);
  }

  /** 可广告的 skill id（与工具同源，便于子集派生时一并过滤）。 */
  skillIds(): string[] {
    return [...this.skills];
  }

  /**
   * 派生子集：剔除指定 id（工具与 skill 都查）。用于子 agent——
   * 例如 child = parent.without(call_subagents, ask_user)。
   */
  without(...ids: string[]): ToolSet {
    const exclude = new Set(ids);
    return new ToolSet(
      this.members.filter(m => !exclude.has(m.id)),
      this.skills.filter(s => !exclude.has(s)),
    );
  }
}
