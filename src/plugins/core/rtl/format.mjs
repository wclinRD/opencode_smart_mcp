/**
 * Format — 輸出格式化（text / json / markdown / mermaid）
 */

// ═══════════════════════════════════════════════════════════════════════════
// Text 格式
// ═══════════════════════════════════════════════════════════════════════════

export function formatHierarchyText(hierarchy) {
  if (hierarchy.error) return `❌ ${hierarchy.error}`;
  const lines = [];

  for (const tree of hierarchy.trees) {
    renderTreeText(tree, lines, '', true);
  }

  lines.push('');
  lines.push(`📊 Max depth: ${hierarchy.maxDepth}`);
  return lines.join('\n');
}

function renderTreeText(node, lines, prefix, isLast) {
  const connector = isLast ? '└── ' : '├── ';
  const name = node.name || '?';
  const file = node.file ? ` (${node.file}:${node.line || '?'})` : '';
  const ports = node.ports ? ` [${node.ports} ports]` : '';
  const inst = node.instanceName ? ` ← ${node.instanceName}` : '';
  const cycle = node.cycle ? ' ⚠️ CYCLE' : '';
  const unknown = node.unknown ? ' ❓ unknown module' : '';

  lines.push(`${prefix}${connector}${name}${file}${ports}${inst}${cycle}${unknown}`);

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  const children = node.children || [];
  children.forEach((child, i) => {
    renderTreeText(child, lines, childPrefix, i === children.length - 1);
  });
}

export function formatPortsText(portInfo) {
  if (portInfo.error) return `❌ ${portInfo.error}`;
  const lines = [];

  lines.push(`📋 Module: ${portInfo.name}`);
  lines.push(`📁 File: ${portInfo.file}:${portInfo.line}`);
  lines.push(`📊 Ports: ${portInfo.portCount}`);
  lines.push('');

  if (portInfo.inputs.length > 0) {
    lines.push('  ⬇️  Inputs:');
    for (const p of portInfo.inputs) {
      const bus = p.bus || '';
      lines.push(`    ${p.direction} ${bus} ${p.name}`);
    }
  }

  if (portInfo.outputs.length > 0) {
    lines.push('  ⬆️  Outputs:');
    for (const p of portInfo.outputs) {
      const bus = p.bus || '';
      lines.push(`    ${p.direction} ${bus} ${p.name}`);
    }
  }

  if (portInfo.inouts.length > 0) {
    lines.push('  ↕️  Inouts:');
    for (const p of portInfo.inouts) {
      const bus = p.bus || '';
      lines.push(`    ${p.direction} ${bus} ${p.name}`);
    }
  }

  return lines.join('\n');
}

export function formatAnalyzeText(analysis) {
  const lines = [];

  lines.push('📋 RTL Design Analysis');
  lines.push('━'.repeat(21));
  lines.push('');

  // Stats
  const s = analysis.stats;
  lines.push('📊 Summary');
  lines.push(`  Modules:    ${s.moduleCount}`);
  lines.push(`  Top-level:  ${s.topModuleCount}`);
  lines.push(`  Ports:      ${s.totalPorts} (${s.totalInputs} in, ${s.totalOutputs} out)`);
  lines.push(`  Instances:  ${s.totalInstances}`);
  lines.push('');

  // Top modules
  if (analysis.topModules.length > 0) {
    lines.push('🌳 Top Modules');
    for (const name of analysis.topModules) {
      lines.push(`  • ${name}`);
    }
    lines.push('');
  }

  // Module list
  lines.push('📦 All Modules');
  for (const mod of analysis.modules) {
    const tag = mod.isTop ? ' [TOP]' : '';
    lines.push(`  • ${mod.name}${tag} — ${mod.ports} ports, ${mod.instances} inst (${mod.file})`);
  }

  // Parent map
  if (Object.keys(analysis.parentMap).length > 0) {
    lines.push('');
    lines.push('🔗 Instantiation Map');
    for (const [child, parents] of Object.entries(analysis.parentMap)) {
      lines.push(`  ${child} ← ${parents.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Mermaid 格式
// ═══════════════════════════════════════════════════════════════════════════

export function formatHierarchyMermaid(hierarchy) {
  if (hierarchy.error) return `%% ${hierarchy.error}`;
  const lines = ['graph TD'];

  function renderMermaid(node, parentId = null) {
    const id = node.name?.replace(/[^a-zA-Z0-9_]/g, '_') || 'unknown';
    const label = node.file ? `${node.name}\\n(${node.file})` : node.name;
    lines.push(`  ${id}["${label}"]`);
    if (parentId) lines.push(`  ${parentId} --> ${id}`);

    for (const child of node.children || []) {
      renderMermaid(child, id);
    }
  }

  for (const tree of hierarchy.trees) {
    renderMermaid(tree);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Markdown 格式
// ═══════════════════════════════════════════════════════════════════════════

export function formatAnalyzeMarkdown(analysis) {
  const lines = [];

  lines.push('# RTL Design Analysis');
  lines.push('');

  const s = analysis.stats;
  lines.push('## Summary');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Modules | ${s.moduleCount} |`);
  lines.push(`| Top-level | ${s.topModuleCount} |`);
  lines.push(`| Total ports | ${s.totalPorts} |`);
  lines.push(`| Inputs | ${s.totalInputs} |`);
  lines.push(`| Outputs | ${s.totalOutputs} |`);
  lines.push(`| Instances | ${s.totalInstances} |`);
  lines.push('');

  if (analysis.topModules.length > 0) {
    lines.push('## Top Modules');
    for (const name of analysis.topModules) {
      lines.push(`- **${name}**`);
    }
    lines.push('');
  }

  lines.push('## All Modules');
  lines.push(`| Name | File | Ports | Instances | Top |`);
  lines.push(`|------|------|-------|-----------|-----|`);
  for (const mod of analysis.modules) {
    lines.push(`| ${mod.name} | ${mod.file} | ${mod.ports} | ${mod.instances} | ${mod.isTop ? '✅' : ''} |`);
  }

  return lines.join('\n');
}

export function formatHierarchyMarkdown(hierarchy) {
  if (hierarchy.error) return `> ❌ ${hierarchy.error}`;
  const lines = [];

  lines.push('# Module Hierarchy');
  lines.push('');

  function renderMd(node, depth = 0) {
    const indent = '  '.repeat(depth);
    const bullet = depth === 0 ? '##' : '- ';
    const file = node.file ? ` (\`${node.file}:${node.line || '?'}\`)` : '';
    lines.push(`${indent}${bullet} ${node.name || '?'}${file}`);
    if (node.cycle) lines.push(`${indent}  > ⚠️ Circular dependency detected`);
    if (node.unknown) lines.push(`${indent}  > ❓ Module definition not found`);
    for (const child of node.children || []) {
      renderMd(child, depth + 1);
    }
  }

  for (const tree of hierarchy.trees) {
    renderMd(tree);
  }

  lines.push('');
  lines.push(`> Max hierarchy depth: ${hierarchy.maxDepth}`);
  return lines.join('\n');
}
