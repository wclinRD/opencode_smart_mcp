// rules.mjs → smart_rules
//
// Project rules injection engine. Reads AGENTS.md, .cursorrules,
// .clinerules, CODEBUDDY.md, and other project-level rule files.
// Injects relevant rules into tool context so the LLM doesn't ignore them.
//
// Solves the "AGENTS.md being ignored" weakness by:
//   1. Making rules discoverable via a dedicated MCP tool
//   2. Auto-injecting matching rules into tool context
//   3. Providing rule validation hooks

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, basename, join } from 'node:path';

const RULE_FILE_PATTERNS = [
  'AGENTS.md', 'AGENTS.yml', 'AGENTS.yaml',
  '.cursorrules', '.cursor/rules',
  '.clinerules', '.claude/rules',
  'CODEBUDDY.md', '.github/copilot-instructions.md',
  '.windsurfrules', '.aider.conf.yml', '.aider.rules',
  'CLAUDE.md', 'RULES.md', '.rules', '.opencode/rules',
];

function discoverRuleFiles(root) {
  const found = [];
  const seen = new Set();
  let current = resolve(root);
  while (current && current !== dirname(current)) {
    for (const pattern of RULE_FILE_PATTERNS) {
      const fullPath = join(current, pattern);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      if (!existsSync(fullPath)) continue;
      try {
        const st = statSync(fullPath);
        if (st.isFile()) {
          found.push({ path: fullPath, relativePath: relative(root, fullPath), type: basename(pattern).replace(/^\./, ''), size: st.size });
        } else if (st.isDirectory()) {
          const files = readdirSync(fullPath).filter(f => f.endsWith('.md') || f.endsWith('.mdc'));
          for (const f of files) {
            const fp = join(fullPath, f);
            const fst = statSync(fp);
            if (fst.isFile()) found.push({ path: fp, relativePath: relative(root, fp), type: `${basename(pattern)}/${f}`, size: fst.size });
          }
        }
      } catch { /* skip */ }
    }
    current = dirname(current);
  }
  return found;
}

function parseSimpleYAML(yamlStr) {
  const result = {};
  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);
    result[key] = value;
  }
  return result;
}

function parseRuleFile(content, filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const result = { sections: [], frontmatter: null, raw: content };

  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx !== -1) {
      try { result.frontmatter = parseSimpleYAML(content.slice(3, endIdx).trim()); } catch {}
      content = content.slice(endIdx + 3).trim();
    }
  }

  if (ext === 'md' || ext === 'mdc' || ext === 'mdx') {
    const sectionRe = /^#{1,3}\s+(.+)$/gm;
    const sections = [];
    let lastIdx = 0;
    let match;
    while ((match = sectionRe.exec(content)) !== null) {
      if (lastIdx > 0) {
        sections.push({ title: content.slice(lastIdx, match.index).split('\n')[0].replace(/^#+\s*/, ''), content: content.slice(lastIdx, match.index).trim() });
      }
      lastIdx = match.index;
    }
    if (lastIdx > 0) {
      sections.push({ title: content.slice(lastIdx).split('\n')[0].replace(/^#+\s*/, ''), content: content.slice(lastIdx).trim() });
    }
    result.sections = sections.map(s => {
      const rules = s.content.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('* ')).map(l => l.replace(/^[-*]\s+/, '').trim());
      return { ...s, rules };
    });
  } else {
    const rules = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => l.trim());
    result.sections = [{ title: basename(filePath), content, rules }];
  }

  return result;
}

function matchRulesToFile(rules, targetFile) {
  if (!targetFile) return rules;
  const ext = targetFile.split('.').pop()?.toLowerCase();
  const fileName = basename(targetFile);
  const dirName = dirname(targetFile);

  return rules.filter(rule => {
    const content = (rule.content || '').toLowerCase();
    if (content.includes(fileName.toLowerCase())) return true;
    if (ext && content.includes(`*.${ext}`)) return true;
    if (content.includes(dirName.toLowerCase())) return true;
    if (content.includes('all files') || content.includes('always')) return true;
    return false;
  });
}

export default {
  name: 'smart_rules',
  category: 'core',
  responsePolicy: { maxLevel: 1 },
  description: 'Use when: need to check project rules (AGENTS.md, .cursorrules, etc.) before editing. Discovers and reads project-level rule files. Use before any edit to ensure compliance with project conventions.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Target file path — returns rules applicable to this file' },
      rule: { type: 'string', description: 'Rule category to search for (e.g., "naming", "style", "testing")' },
      list: { type: 'boolean', description: 'List all discovered rule files' },
      root: { type: 'string', description: 'Project root (default: cwd)' },
      inject: { type: 'boolean', description: 'Inject matching rules as context (default: true)' },
    },
  },

  handler(args) {
    const root = args.root || process.cwd();
    const targetFile = args.file || null;
    const ruleFilter = args.rule || null;
    const listOnly = args.list === true;
    const inject = args.inject !== false;

    const ruleFiles = discoverRuleFiles(root);

    if (listOnly) {
      if (ruleFiles.length === 0) return 'No rule files found in project.';
      const out = [`📋 Project Rules (${ruleFiles.length} files):`];
      for (const rf of ruleFiles) {
        out.push(`  📄 ${rf.relativePath} (${rf.type}, ${(rf.size / 1024).toFixed(1)}KB)`);
      }
      out.push('\n💡 Use smart_rules({file:"path/to/file.js"}) to get rules for a specific file.');
      return out.join('\n');
    }

    if (ruleFiles.length === 0) {
      return 'No rule files found in project. Create AGENTS.md or .cursorrules to define project conventions.';
    }

    const allRules = [];
    for (const rf of ruleFiles) {
      try {
        const content = readFileSync(rf.path, 'utf-8');
        const parsed = parseRuleFile(content, rf.path);
        for (const section of parsed.sections) {
          allRules.push({
            source: rf.relativePath,
            title: section.title,
            content: section.content.slice(0, 2000),
            rules: section.rules,
          });
        }
      } catch { /* skip unreadable */ }
    }

    let matched = targetFile ? matchRulesToFile(allRules, targetFile) : allRules;

    if (ruleFilter) {
      const filter = ruleFilter.toLowerCase();
      matched = matched.filter(r =>
        r.title.toLowerCase().includes(filter) ||
        r.content.toLowerCase().includes(filter) ||
        r.rules.some(rl => rl.toLowerCase().includes(filter))
      );
    }

    if (matched.length === 0) {
      return `No rules found${targetFile ? ` for ${targetFile}` : ''}${ruleFilter ? ` matching "${ruleFilter}"` : ''}. Available rule files: ${ruleFiles.map(r => r.relativePath).join(', ')}`;
    }

    const out = [];
    out.push(`📋 Project Rules${targetFile ? ` for ${targetFile}` : ''}${ruleFilter ? ` (filter: "${ruleFilter}")` : ''}:`);
    out.push('='.repeat(60));

    for (const rule of matched) {
      out.push(`\n### ${rule.title} (from ${rule.source})`);
      if (rule.rules.length > 0) {
        for (const r of rule.rules) {
          out.push(`  • ${r}`);
        }
      } else {
        const lines = rule.content.split('\n').filter(l => l.trim()).slice(0, 10);
        for (const l of lines) out.push(`  ${l}`);
        if (rule.content.length > 2000) out.push(`  ... (truncated, ${rule.content.length} chars total)`);
      }
    }

    if (inject && matched.length > 0) {
      out.push('\n---');
      out.push('✅ Rules injected into context. Follow these conventions in all edits.');
      out.push('💡 Use smart_rules({file:"..."}) before editing any file to check applicable rules.');
    }

    return out.join('\n');
  },
};
