import { promises as fs } from 'fs';
import path from 'path';

// 目录树文本快照（BFS 有界）——会话 session-context 注入用。
const MAX_ITEMS = 200;
const IGNORED_FOLDERS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  'build',
  '.cache',
]);

interface TreeNode {
  name: string;
  files: string[];
  subFolders: TreeNode[];
  /** 预算耗尽 / 被忽略 / 不可读：不再展开，渲染为 `name/ …`。 */
  truncated: boolean;
}

async function readTree(rootPath: string): Promise<TreeNode> {
  const root: TreeNode = {
    name: path.basename(rootPath) || rootPath,
    files: [],
    subFolders: [],
    truncated: false,
  };
  const queue: Array<{ node: TreeNode; dir: string }> = [
    { node: root, dir: rootPath },
  ];
  let budget = MAX_ITEMS;
  const seen = new Set<string>();

  while (queue.length > 0 && budget > 0) {
    const { node, dir } = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);

    let entries;
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch {
      node.truncated = true;
      continue;
    }

    for (const entry of entries) {
      if (budget <= 0) {
        node.truncated = true;
        break;
      }
      if (entry.isFile()) {
        node.files.push(entry.name);
        budget--;
      } else if (entry.isDirectory()) {
        const ignored = IGNORED_FOLDERS.has(entry.name);
        const child: TreeNode = {
          name: entry.name,
          files: [],
          subFolders: [],
          truncated: ignored,
        };
        node.subFolders.push(child);
        budget--;
        if (!ignored)
          queue.push({ node: child, dir: path.join(dir, entry.name) });
      }
    }
  }
  // 预算耗尽后未访问的排队节点标记截断，避免渲染成空目录。
  for (const { node } of queue) node.truncated = true;
  return root;
}

function renderNode(
  node: TreeNode,
  indent: string,
  isLast: boolean,
  isRoot: boolean,
  out: string[],
): void {
  if (!isRoot)
    out.push(
      `${indent}${isLast ? '└── ' : '├── '}${node.name}/${node.truncated ? ' …' : ''}`,
    );
  const childIndent = isRoot ? '' : `${indent}${isLast ? '    ' : '│   '}`;
  const entries: Array<{ label: string; child?: TreeNode }> = [
    ...node.files.map(name => ({ label: name })),
    ...node.subFolders.map(sub => ({ label: sub.name, child: sub })),
  ];
  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    if (entry.child) renderNode(entry.child, childIndent, last, false, out);
    else out.push(`${childIndent}${last ? '└── ' : '├── '}${entry.label}`);
  });
}

/** 目录树文本：BFS ≤200 项（文件+目录），node_modules 等忽略，`…` 标截断/忽略。 */
export async function renderDirectoryTree(rootPath: string): Promise<string> {
  const root = await readTree(rootPath);
  const out: string[] = [];
  renderNode(root, '', true, true, out);
  return [
    `Directory structure (up to ${MAX_ITEMS} items, '…' marks truncation):`,
    `${rootPath}/`,
    ...out,
  ].join('\n');
}
