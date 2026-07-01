// ── Atomic Thinking DAG 實作（decompose-dag）──
// 研究來源：Atomic Thinking DAG (OpenReview 2025)、DPPM (arXiv 2506.02683)

// ═══════════════════════════════════════════
// F1: Topological Sort（Kahn's algorithm）
// ═══════════════════════════════════════════

/**
 * DAG 拓撲排序 — Kahn's algorithm
 * @param {Array<{id: number, deps?: number[]}>} nodes
 * @returns {object} { sorted: number[], circular: boolean, circularPath: number[] }
 */
export function dagSort(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { sorted: [], circular: false, circularPath: [] };
  }

  const inDegree = new Map();
  const adj = new Map();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const n of nodes) {
    if (Array.isArray(n.deps)) {
      for (const dep of n.deps) {
        if (adj.has(dep)) {
          adj.get(dep).push(n.id);
          inDegree.set(n.id, (inDegree.get(n.id) || 0) + 1);
        }
      }
    }
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const neighbor of (adj.get(id) || [])) {
      const newDeg = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== nodes.length) {
    // 找出 circular path
    const remaining = nodes.filter(n => !sorted.includes(n.id));
    const path = remaining.map(n => n.id);
    return { sorted, circular: true, circularPath: path };
  }

  return { sorted, circular: false, circularPath: [] };
}

// ═══════════════════════════════════════════
// F2: 取得可執行節點
// ═══════════════════════════════════════════

/**
 * 取得 DAG 中可執行、阻塞、已完成的節點
 * @param {Array<{id: number, deps?: number[], status?: string}>} nodes
 * @param {number[]} doneIds — 已完成的節點 ID 列表
 * @returns {object} { ready: Array, blocked: Array, done: Array }
 */
export function dagGetReadyNodes(nodes, doneIds) {
  if (!Array.isArray(nodes)) return { ready: [], blocked: [], done: [] };

  const doneSet = new Set(doneIds || []);

  const ready = [];
  const blocked = [];
  const done = [];

  for (const node of nodes) {
    if (doneSet.has(node.id) || node.status === 'done') {
      done.push(node);
      continue;
    }
    const deps = Array.isArray(node.deps) ? node.deps : [];
    const allDepsDone = deps.every(d => doneSet.has(d));
    if (allDepsDone) {
      ready.push(node);
    } else {
      blocked.push(node);
    }
  }

  return { ready, blocked, done };
}

// ═══════════════════════════════════════════
// F3: DAG 參數驗證
// ═══════════════════════════════════════════

/**
 * DAG 參數驗證
 * @param {Array<{id: number, desc?: string, status?: string, deps?: number[], atomic?: boolean}>} nodes
 * @returns {object} { errors: string[], warnings: string[], converted: boolean }
 */
export function dagValidate(nodes) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { errors: ['nodes is empty'], warnings: [], converted: false };
  }

  const ids = new Set(nodes.map(n => n.id));

  for (const node of nodes) {
    if (node.id == null) errors.push('node missing id');
    if (!node.desc) errors.push(`node ${node.id}: missing desc`);
    if (node.status && !['pending', 'in_progress', 'done', 'blocked'].includes(node.status)) {
      errors.push(`node ${node.id}: invalid status "${node.status}"`);
    }
    if (Array.isArray(node.deps)) {
      for (const dep of node.deps) {
        if (!ids.has(dep)) {
          errors.push(`node ${node.id}: deps ${dep} not found`);
        }
      }
      // 檢查 self-dependency
      if (node.deps.includes(node.id)) {
        errors.push(`node ${node.id}: self-dependency detected`);
      }
    }
    // atomic node 不應有 deps
    if (node.atomic && Array.isArray(node.deps) && node.deps.length > 0) {
      warnings.push(`node ${node.id}: atomic node with deps — atomic ignored`);
    }
  }

  // 檢查 circular dependency
  const { circular, circularPath } = dagSort(nodes);
  if (circular) {
    errors.push(`circular dependency detected: ${circularPath.join(' → ')}`);
  }

  return { errors, warnings, converted: false };
}

/**
 * 將 P1 subtasks 格式轉換為 dagNodes
 * @param {Array} subtasks
 * @returns {Array} dagNodes
 */
export function subtasksToDAG(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks.map(s => ({
    id: s.id,
    desc: s.desc,
    status: s.status || 'pending',
    deps: s.deps || [],
    tool: s.tool || '',
    toolArgs: s.toolArgs || {},
    evidence: s.evidence || '',
    atomic: false,
  }));
}

// ═══════════════════════════════════════════
// F4: DAG 輸出格式
// ═══════════════════════════════════════════

/**
 * 產生 DAG ASCII 視覺化
 * @param {Array} nodes
 * @param {number[]} doneIds
 * @returns {string} ASCII 樹狀圖
 */
export function formatDAG(nodes, doneIds) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '';

  const doneSet = new Set(doneIds || []);
  const lines = [];
  lines.push('┌─ DAG ────────────────────────');

  // 找出根節點（無 deps）
  const roots = nodes.filter(n => !Array.isArray(n.deps) || n.deps.length === 0);

  for (const root of roots) {
    const treeLines = buildDAGTree(root, nodes, doneSet, 0, new Set());
    for (const tl of treeLines) lines.push(`│ ${tl}`);
  }

  // 顯示可平行執行節點
  const { ready } = dagGetReadyNodes(nodes, doneIds);
  const readyNames = ready.filter(r => !doneSet.has(r.id)).map(r => r.desc);
  if (readyNames.length > 1) {
    lines.push('│');
    lines.push(`│ 📋 可平行執行：${readyNames.join(', ')}`);
  }

  lines.push('└──────────────────────────────');
  return lines.join('\n');
}

/**
 * 遞迴建立 DAG 樹狀圖行
 */
function buildDAGTree(node, allNodes, doneSet, depth, visited) {
  const lines = [];
  const indent = depth > 0 ? '  '.repeat(depth) + '└─ ' : '';
  const marker = doneSet.has(node.id) ? '✅' : (node.status === 'in_progress' ? '🔄' : '⬜');
  const toolHint = node.tool ? ` [${node.tool}]` : '';
  lines.push(`${indent}${marker} ${node.desc} (id:${node.id})${toolHint}`);

  if (visited.has(node.id)) return lines;
  visited.add(node.id);

  const children = allNodes.filter(n =>
    Array.isArray(n.deps) && n.deps.includes(node.id)
  );

  for (const child of children) {
    const childLines = buildDAGTree(child, allNodes, doneSet, depth + 1, visited);
    lines.push(...childLines);
  }

  return lines;
}

// ═══════════════════════════════════════════
// F5: DAG + ADAPT 交互
// ═══════════════════════════════════════════

/**
 * ADAPT 分解產生的子節點，自動繼承父節點 deps
 * @param {Array} dagNodes — 當前 DAG
 * @param {number} parentId — 父節點 ID
 * @param {Array<string>} subSteps — 子步驟描述陣列
 * @returns {Array} 新節點陣列
 */
export function dagCreateSubNodes(dagNodes, parentId, subSteps) {
  if (!Array.isArray(subSteps) || subSteps.length === 0) return [];

  const parent = dagNodes.find(n => n.id === parentId);
  const parentDeps = parent && Array.isArray(parent.deps) ? parent.deps : [];
  const maxId = Math.max(...dagNodes.map(n => n.id), 0);

  const newNodes = [];
  let prevSubId = null;

  for (let i = 0; i < subSteps.length; i++) {
    const subId = maxId + i + 1;
    const deps = i === 0
      ? [...parentDeps]  // 第一個子節點繼承父節點 deps
      : [prevSubId];     // 後續子節點依賴前一個子節點

    newNodes.push({
      id: subId,
      desc: subSteps[i],
      status: i === 0 ? 'in_progress' : 'pending',
      deps,
      parentId,
      tool: '',
      toolArgs: {},
      evidence: '',
      atomic: true, // ADAPT 產生的子節點預設為原子節點
    });

    prevSubId = subId;
  }

  return newNodes;
}
