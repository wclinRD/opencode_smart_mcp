// consistency-check.mjs — Harness Engineering 機械化一致性檢查
//
// Scans project for structural drift: file count mismatches,
// cross-reference breaks, stale declarations.
// Returns structured findings with fix hints.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { cwd } from 'node:process';

export default {
  name: 'smart_consistency_check',
  category: 'standard',
  description: `Harness Engineering 機械化一致性檢查。掃描專案結構飄移：
- 檔案數與 README 聲明是否一致
- wikilink/cross-reference 是否斷裂
- 目錄結構是否與聲明同步
- golden rules 是否被違反

每個違反回報內嵌修復指令，agent 可自行修正。`,
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Project root (default: cwd)' },
      checks: { type: 'string', enum: ['all', 'file-counts', 'cross-refs', 'golden-rules'], description: 'Which checks to run (default: all)' }
    }
  },
  responsePolicy: { maxLevel: 0 },

  handler: async (args) => {
    const root = resolve(args.root || cwd());
    const checks = args.checks || 'all';
    const findings = [];

    // ── C1: File count consistency ──
    if (checks === 'all' || checks === 'file-counts') {
      const readmePath = join(root, 'README.md');
      if (existsSync(readmePath)) {
        const readme = readFileSync(readmePath, 'utf-8');
        // Check directories vs README declarations
        const items = readdirSync(root, { withFileTypes: true });
        for (const item of items) {
          if (!item.isDirectory() || item.name.startsWith('.')) continue;
          const files = readdirSync(join(root, item.name)).filter(f => f.endsWith('.md') || f.endsWith('.mjs'));
          const declPattern = new RegExp(`${item.name}\\/.*?(\\d+)\\s*篇`);
          const match = readme.match(declPattern);
          if (match && parseInt(match[1]) !== files.length) {
            findings.push({
              id: 'C1',
              severity: 'warn',
              message: `目錄 ${item.name}/ 有 ${files.length} 個檔案，但 README 聲明 ${match[1]} 篇`,
              fix: `更新 README 中 ${item.name}/ 的計數為 ${files.length}`
            });
          }
        }
      }
    }

    // ── C2: Cross-reference check ──
    if (checks === 'all' || checks === 'cross-refs') {
      const mdFiles = [];
      const walkDir = (dir) => {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
              walkDir(full);
            } else if (entry.name.endsWith('.md')) {
              mdFiles.push(full);
            }
          }
        } catch { /* skip unreadable */ }
      };
      walkDir(root);

      // Check wikilinks [[...]] point to existing files
      const knownPaths = new Set(mdFiles.map(f => relative(root, f).replace(/\.md$/, '').toLowerCase()));
      for (const file of mdFiles) {
        const content = readFileSync(file, 'utf-8');
        const links = content.match(/\[\[([^\]]+)\]\]/g) || [];
        for (const link of links) {
          const target = link.slice(2, -2).toLowerCase();
          if (!knownPaths.has(target)) {
            findings.push({
              id: 'C2',
              severity: 'info',
              file: relative(root, file),
              message: `斷裂的 wikilink：[[${target}]]`,
              fix: `建立 ${target}.md 或修正連結`
            });
          }
        }
      }
    }

    // ── C3: Golden rules check ──
    if (checks === 'all' || checks === 'golden-rules') {
      const rulesPath = join(root, 'AGENTS.md');
      const cursorRules = join(root, '.cursorrules');
      let ruleCount = 0;
      if (existsSync(rulesPath)) {
        const content = readFileSync(rulesPath, 'utf-8');
        const rules = content.match(/^[*-]\s+\[\s*[x ]?\s*\]/gm);
        ruleCount += rules ? rules.length : 0;
      }
      if (ruleCount === 0 && existsSync(cursorRules)) {
        findings.push({
          id: 'C3',
          severity: 'info',
          message: 'AGENTS.md 中沒有機械化 golden rules，或規則未被標記為可執行',
          fix: '在 AGENTS.md 中使用 checklist 格式（- [ ]）定義 golden rules'
        });
      }
    }

    // Summary
    const bySeverity = { error: 0, warn: 0, info: 0 };
    for (const f of findings) bySeverity[f.severity]++;

    return JSON.stringify({
      ok: true,
      total: findings.length,
      bySeverity,
      findings,
      instruction: findings.length === 0
        ? '✅ 所有一致性檢查通過'
        : '使用 smart_fast_apply 逐一修復 findings 中的問題'
    }, null, 2);
  }
};
