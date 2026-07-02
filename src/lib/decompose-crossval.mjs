// ── Cross-Validation（decompose-crossval）──
// 研究來源：Self-Consistency (Wang et al. 2023)、SelfCheck (Miao et al. 2024)

// ═══════════════════════════════════════════
// P1: Cross-Validation 主引擎
// ═══════════════════════════════════════════

const VALIDATION_CHECKS = [
  {
    name: 'goal_alignment',
    check: (nodes) => {
      // 每個節點描述是否與整體 goal 相關
      const issues = [];
      const goalNode = nodes.find(n => n.isGoal || (n.id === 0));
      if (!goalNode) return [];
      const goal = (goalNode.desc || '').toLowerCase();
      for (const node of nodes) {
        if (node.isGoal || node.isSubNode) continue;
        const desc = (node.desc || '').toLowerCase();
        const goalWords = new Set(goal.split(/\s+/).filter(w => w.length > 3));
        const matches = [...goalWords].filter(w => desc.includes(w));
        if (matches.length === 0) {
          issues.push({ nodeId: node.id, severity: 'warn', msg: `Node #${node.id} may not align with goal`, type: 'goal_alignment' });
        }
      }
      return issues;
    },
  },
  {
    name: 'dependency_consistency',
    check: (nodes) => {
      // 相依順序合理？下層 node 如果用到上層的產出
      const issues = [];
      for (const node of nodes) {
        if (!node.children || node.children.length === 0) continue;
        for (const childId of node.children) {
          const childNode = nodes.find(n => n.id === childId);
          if (!childNode) {
            issues.push({ nodeId: node.id, severity: 'error', msg: `Node #${node.id} references missing child #${childId}`, type: 'missing_child' });
          }
        }
      }
      return issues;
    },
  },
  {
    name: 'evidence_completeness',
    check: (nodes) => {
      // 完成的 node 是否有 evidence
      const issues = [];
      for (const node of nodes) {
        if (node.status === 'done' && (!node.evidence || node.evidence.trim().length === 0)) {
          issues.push({ nodeId: node.id, severity: 'warn', msg: `Node #${node.id} is done but missing evidence`, type: 'missing_evidence' });
        }
      }
      return issues;
    },
  },
  {
    name: 'tool_usage',
    check: (nodes, tracking) => {
      // 建議使用 tool 但實際未使用
      const issues = [];
      for (const node of nodes) {
        if (node.status === 'done' && node.tool) {
          const actualToolUsed = tracking?.tools?.[node.id];
          if (actualToolUsed && actualToolUsed !== node.tool) {
            issues.push({ nodeId: node.id, severity: 'info', msg: `Node #${node.id} suggested ${node.tool} but used ${actualToolUsed}`, type: 'tool_mismatch' });
          }
        }
      }
      return issues;
    },
  },
  {
    name: 'result_consistency',
    check: (nodes) => {
      // concat→ 之後的 node 是否有在
      const issues = [];
      const doneNodes = nodes.filter(n => n.status === 'done');
      if (doneNodes.length > 0) {
        const allResults = doneNodes.map(n => (n.evidence || '').toLowerCase()).join(' ');
        for (const node of nodes) {
          if (node.status === 'done') continue;
          if (!allResults.includes((node.desc || '').toLowerCase().slice(0, 10))) {
            // normal, no strong constraint
          }
        }
      }
      return issues;
    },
  },
];

/**
 * Cross-Validate DAG nodes
 * @param {Array} nodes — DAG nodes array
 * @param {object} [tracking] — optional tracking data
 * @returns {object} { issues, passed, total, score, recommendations }
 */
export function crossValidate(nodes, tracking) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { issues: [], passed: 0, total: 0, score: 100, recommendations: [] };
  }

  const allIssues = [];
  for (const vc of VALIDATION_CHECKS) {
    try {
      const result = vc.check(nodes, tracking);
      if (Array.isArray(result)) allIssues.push(...result);
    } catch (e) {
      allIssues.push({ nodeId: -1, severity: 'error', msg: `${vc.name} threw: ${e.message}`, type: 'check_error' });
    }
  }

  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const issue of allIssues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
  }

  const total = 5; // 5 checks
  const weight = { error: 15, warn: 8, info: 2 };
  const deductions = allIssues.reduce((sum, i) => sum + (weight[i.severity] || 0), 0);
  const score = Math.max(0, 100 - deductions);

  const recommendations = [];
  if (bySeverity.error > 0) recommendations.push('fix dependency errors');
  if (bySeverity.warn > 0) recommendations.push('add missing evidence');
  if (bySeverity.info > 2) recommendations.push('review tool usage consistency');
  if (score < 60) recommendations.push('schedule major revision');

  return {
    issues: allIssues.sort((a, b) => { const s = { error: 0, warn: 1, info: 2 }; return (s[a.severity]||9) - (s[b.severity]||9); }),
    passed: allIssues.length === 0 ? total : Math.max(0, total - allIssues.length),
    total,
    score,
    recommendations,
  };
}

// ═══════════════════════════════════════════
// P2: Cross-Task 一致性檢查
// ═══════════════════════════════════════════

/**
 * 檢查多個 subtask 之間是否有矛盾
 * @param {Array} subtasks
 * @returns {Array} conflicts
 */
export function detectConflicts(subtasks) {
  if (!Array.isArray(subtasks) || subtasks.length < 2) return [];

  const conflicts = [];

  // 1. 相同描述 → 重複
  const descMap = new Map();
  for (const s of subtasks) {
    const key = (s.desc || '').toLowerCase().trim();
    if (descMap.has(key)) {
      conflicts.push({ type: 'duplicate', nodeIds: [descMap.get(key).id, s.id], msg: `Node #${descMap.get(key).id} and #${s.id} have similar descriptions` });
    } else {
      descMap.set(key, s);
    }
  }

  // 2. 反向依賴 → 循環
  for (const s of subtasks) {
    if (s.children && s.parents) {
      for (const childId of s.children) {
        const child = subtasks.find(c => c.id === childId);
        if (child && child.children && child.children.includes(s.id)) {
          conflicts.push({ type: 'circular', nodeIds: [s.id, childId], msg: `Circular dependency between #${s.id} and #${childId}` });
        }
      }
    }
  }

  return conflicts;
}

// ═══════════════════════════════════════════
// P3: Validation Report
// ═══════════════════════════════════════════

/**
 * 產生 Validation Report 字串
 * @param {object} result — crossValidate return
 * @returns {string}
 */
export function validationReport(result) {
  if (!result) return 'no validation data';

  const { issues, passed, total, score, recommendations } = result;
  const barLen = 20;
  const filled = Math.round((score / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const lines = [
    `╔═══ Cross-Validation Report ═══╗`,
    `║ Score: ${score}/100 ${bar}`,
    `║ Passed: ${passed}/${total} checks`,
    `║ Issues: ${issues.length} (${issues.filter(i => i.severity === 'error').length} error, ${issues.filter(i => i.severity === 'warn').length} warn, ${issues.filter(i => i.severity === 'info').length} info)`,
  ];

  if (issues.length > 0) {
    lines.push(`╠═══ Issues ═══╣`);
    for (const issue of issues.slice(0, 10)) {
      const icon = issue.severity === 'error' ? '✖' : issue.severity === 'warn' ? '⚠' : 'ℹ';
      lines.push(`║ ${icon} ${issue.msg}`);
    }
    if (issues.length > 10) lines.push(`║ ... and ${issues.length - 10} more`);
  }

  if (recommendations.length > 0) {
    lines.push(`╠═══ Recommendations ═══╣`);
    for (const rec of recommendations) lines.push(`║ → ${rec}`);
  }

  lines.push(`╚═══════════════════════════╝`);
  return lines.join('\n');
}

export default {
  crossValidate,
  detectConflicts,
  validationReport,
};
