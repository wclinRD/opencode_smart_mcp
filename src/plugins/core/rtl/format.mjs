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
  if (s.floatSignals > 0) {
    lines.push(`  ⚠️  Floats:   ${s.floatSignals}`);
  }
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
// Graphviz DOT 格式
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 格式化 module hierarchy 為 Graphviz DOT
 */
export function formatHierarchyDot(hierarchy) {
  if (hierarchy.error) return `// ${hierarchy.error}`;
  const lines = ['digraph Hierarchy {', '  rankdir=TB;', '  node [shape=box style=filled fillcolor=lightblue];', ''];

  function renderDot(node, parentId = null) {
    const id = node.name?.replace(/[^a-zA-Z0-9_]/g, '_') || 'unknown';
    const label = node.file ? `${node.name}\\n(${node.file}:${node.line || '?'})` : node.name;
    const ports = node.ports ? ` [${node.ports}p]` : '';
    lines.push(`  ${id} [label="${label}${ports}"];`);
    if (parentId) lines.push(`  ${parentId} -> ${id};`);

    for (const child of node.children || []) {
      renderDot(child, id);
    }
  }

  for (const tree of hierarchy.trees) {
    renderDot(tree);
  }

  lines.push('}');
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Signal Graph 格式
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 格式化 signal 列表
 */
export function formatSignalsText(signalInfo) {
  if (signalInfo.error) return `❌ ${signalInfo.error}`;
  const lines = [];

  lines.push(`📋 Module: ${signalInfo.name}`);
  lines.push(`📁 File: ${signalInfo.file}`);
  lines.push(`📊 Signals: ${signalInfo.signalCount}`);
  lines.push('');

  if (signalInfo.nets.length > 0) {
    lines.push('  🔗 Nets (wire):');
    for (const s of signalInfo.nets) {
      const bus = s.bus || '';
      lines.push(`    wire ${bus} ${s.name}`);
    }
  }

  if (signalInfo.variables.length > 0) {
    lines.push('  📦 Variables (reg):');
    for (const s of signalInfo.variables) {
      const bus = s.bus || '';
      lines.push(`    reg ${bus} ${s.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化 signal trace
 */
export function formatTraceText(traceInfo) {
  if (traceInfo.error) return `❌ ${traceInfo.error}`;
  const lines = [];

  lines.push(`🔍 Signal Trace: ${traceInfo.signalName}`);
  lines.push('━'.repeat(30));
  lines.push('');

  if (traceInfo.traces.length === 0) {
    lines.push('  (no connections found)');
  } else {
    for (const t of traceInfo.traces) {
      if (t.declaration) {
        lines.push(`  📦 ${t.module} — ${t.type} ${t.bus || ''} ${traceInfo.signalName}`);
      } else {
        lines.push(`  ${t.module}.${t.instance} (${t.instanceModule})`);
        lines.push(`    └─ .${t.port} ← ${t.connectedTo}`);
      }
    }
  }

  lines.push('');
  lines.push(`📊 Found ${traceInfo.traceCount} connection(s)`);
  return lines.join('\n');
}

/**
 * 格式化 float signals 為 Mermaid 圖
 */
export function formatFloatMermaid(floatInfo) {
  const lines = ['graph LR'];

  const allSignals = [
    ...floatInfo.noLoad.map(s => ({ ...s, type: 'noLoad' })),
    ...floatInfo.noDriver.map(s => ({ ...s, type: 'noDriver' })),
  ];

  if (allSignals.length === 0) {
    lines.push('  ok["✅ No float signals"]');
    return lines.join('\n');
  }

  for (const s of allSignals) {
    const id = `${s.module}__${s.signal}`.replace(/[^a-zA-Z0-9_]/g, '_');
    const bus = s.bus || '';
    if (s.type === 'noLoad') {
      lines.push(`  ${id}["🔴 ${s.module}.${s.signal}${bus}"]`);
      lines.push(`  ${id} -->|no load| unused["unused"]`);
    } else {
      lines.push(`  ${id}["🟡 ${s.module}.${s.signal}${bus}"]`);
      lines.push(`  undriven["undriven"] -->|drives| ${id}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化 float signals 為 Graphviz DOT
 */
export function formatFloatDot(floatInfo) {
  const lines = ['digraph FloatSignals {', '  rankdir=LR;', '  node [shape=box];', ''];

  const allSignals = [
    ...floatInfo.noLoad.map(s => ({ ...s, type: 'noLoad' })),
    ...floatInfo.noDriver.map(s => ({ ...s, type: 'noDriver' })),
  ];

  if (allSignals.length === 0) {
    lines.push('  ok [label="✅ No float signals" shape=ellipse style=filled fillcolor=lightgreen];');
  } else {
    for (const s of allSignals) {
      const id = `${s.module}_${s.signal}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const bus = s.bus || '';
      const label = `${s.module}\\n${s.signal}${bus}`;
      if (s.type === 'noLoad') {
        lines.push(`  ${id} [label="${label}" style=filled fillcolor=lightyellow];`);
        lines.push(`  ${id} -> unused [label="${s.reason}" style=dashed];`);
      } else {
        lines.push(`  ${id} [label="${label}" style=filled fillcolor=lightyellow];`);
        lines.push(`  undriven -> ${id} [label="${s.reason}" style=dashed];`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * 格式化 check 結果
 */
export function formatCheckText(checkResult) {
  const lines = [];

  lines.push('🔍 RTL Design Check');
  lines.push('━'.repeat(20));
  lines.push('');

  // Unconnected ports
  const { unconnected } = checkResult;
  if (unconnected.count === 0) {
    lines.push('✅ No unconnected ports');
  } else {
    lines.push(`⚠️  Unconnected Ports (${unconnected.count}):`);
    for (const u of unconnected) {
      lines.push(`  ${u.module}.${u.instance} (.${u.port}) — ${u.direction} [${u.width || 1}b]`);
    }
  }
  lines.push('');

  // Width mismatches
  const { widthMismatches } = checkResult;
  if (widthMismatches.count === 0) {
    lines.push('✅ No width mismatches');
  } else {
    lines.push(`⚠️  Width Mismatches (${widthMismatches.count}):`);
    for (const m of widthMismatches) {
      lines.push(`  ${m.module}.${m.instance} (.${m.port}) — port ${m.portWidth}b vs signal ${m.connectedWidth}b`);
    }
  }
  lines.push('');

  // Float signals
  const { floatSignals } = checkResult;
  if (floatSignals) {
    if (floatSignals.noLoadCount === 0 && floatSignals.noDriverCount === 0) {
      lines.push('✅ No float signals');
    } else {
      if (floatSignals.noLoadCount > 0) {
        lines.push(`⚠️  Signals with no load (${floatSignals.noLoadCount}):`);
        for (const f of floatSignals.noLoad) {
          const bus = f.bus || '';
          lines.push(`  ${f.module}.${f.signal}${bus} — ${f.type || ''} (${f.reason})`);
        }
        lines.push('');
      }
      if (floatSignals.noDriverCount > 0) {
        lines.push(`⚠️  Signals with no driver (${floatSignals.noDriverCount}):`);
        for (const f of floatSignals.noDriver) {
          const bus = f.bus || '';
          lines.push(`  ${f.module}.${f.signal}${bus} — ${f.type || ''} (${f.reason})`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Lint 格式（Constraint 完整性檢查）
// ═══════════════════════════════════════════════════════════════════════════

export function formatLintText(result) {
  const lines = [];
  lines.push('⏱️  Constraint Lint Report');
  lines.push('━'.repeat(22));
  lines.push('');

  // SDC 檔案摘要
  if (result.sdcFiles.length === 0) {
    lines.push('⚠️  未找到 SDC 檔案（constraint 驗證將跳過 SDC 比對）');
    lines.push('');
  } else {
    lines.push(`📂 SDC Files: ${result.sdcFiles.length}`);
    for (const f of result.sdcFiles) {
      lines.push(`  • ${f}`);
    }
    lines.push('');
  }

  // Clock 摘要
  if (result.clocks.length > 0) {
    lines.push(`🕐 Clocks (${result.clocks.length}):`);
    for (const c of result.clocks) {
      const period = c.period ? `${c.period} ns` : '?';
      const name = c.name ? ` [${c.name}]` : '';
      lines.push(`  • ${c.port || '?'}${name} — period ${period}`);
    }
    lines.push('');
  }

  // Top-level port 摘要
  lines.push(`📊 Top-level Ports: ${result.topLevelPortCount}`);

  // Unconstrained ports
  const hasIssue = result.totalUnconstrained > 0;

  if (result.unconstrainedInputs.length > 0) {
    lines.push('');
    lines.push(`🔴 Unconstrained Inputs (${result.unconstrainedInputs.length}):`);
    for (const p of result.unconstrainedInputs) {
      const bus = p.width > 1 ? `[${p.width - 1}:0]` : '';
      lines.push(`  ⚠️  ${p.name}${bus} — ${p.module}`);
    }
  }

  if (result.unconstrainedOutputs.length > 0) {
    lines.push('');
    lines.push(`🔴 Unconstrained Outputs (${result.unconstrainedOutputs.length}):`);
    for (const p of result.unconstrainedOutputs) {
      const bus = p.width > 1 ? `[${p.width - 1}:0]` : '';
      lines.push(`  ⚠️  ${p.name}${bus} — ${p.module}`);
    }
  }

  if (!hasIssue) {
    lines.push('');
    lines.push('✅ 所有 top-level port 都有 constraint');
  }

  // Fix suggestions
  if (result.fixes && result.fixes.length > 0) {
    lines.push('');
    lines.push('💡 Fix Suggestions:');
    lines.push('━'.repeat(20));

    // Name mismatches first
    const mismatches = result.fixes.filter(f => f.mismatch);
    if (mismatches.length > 0) {
      lines.push('');
      lines.push('  🔧 Name Mismatches:');
      for (const f of mismatches) {
        lines.push(`    ⚠️  RTL: ${f.port} ←→ SDC: ${f.mismatch.sdc}`);
        lines.push(`        建議：統一其中一個名稱`);
      }
    }

    // SDC template
    const sdcFixes = result.fixes.filter(f => f.suggestedSdc);
    if (sdcFixes.length > 0) {
      lines.push('');
      lines.push('  📝 SDC Template（複製到你的 .sdc 檔案）:');
      lines.push('  ```sdc');
      for (const f of sdcFixes) {
        lines.push('  ' + f.suggestedSdc);
      }
      lines.push('  ```');
    }
  }

  // Summary
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Constrained: ${result.totalConstrained}`);
  lines.push(`  Unconstrained: ${result.totalUnconstrained}`);

  return lines.join('\n');
}

export function formatLintMarkdown(result) {
  const lines = [];
  lines.push('# ⏱️ Constraint Lint Report');
  lines.push('');

  // SDC 檔案
  if (result.sdcFiles.length === 0) {
    lines.push('> ⚠️ 未找到 SDC 檔案');
  } else {
    lines.push('## 📂 SDC Files');
    for (const f of result.sdcFiles) {
      lines.push(`- \`${f}\``);
    }
  }
  lines.push('');

  // Clocks
  if (result.clocks.length > 0) {
    lines.push('## 🕐 Clocks');
    lines.push('| Port | Period | Name |');
    lines.push('|------|--------|------|');
    for (const c of result.clocks) {
      lines.push(`| \`${c.port || '?'}\` | ${c.period || '?'} ns | ${c.name || '-'} |`);
    }
    lines.push('');
  }

  // Top-level ports
  lines.push(`## 📊 Top-level Ports: ${result.topLevelPortCount}`);
  lines.push('');

  if (result.unconstrainedInputs.length > 0) {
    lines.push(`### 🔴 Unconstrained Inputs (${result.unconstrainedInputs.length})`);
    lines.push('| Port | Width | Module |');
    lines.push('|------|-------|--------|');
    for (const p of result.unconstrainedInputs) {
      lines.push(`| \`${p.name}\` | ${p.width || 1} | ${p.module} |`);
    }
    lines.push('');
  }

  if (result.unconstrainedOutputs.length > 0) {
    lines.push(`### 🔴 Unconstrained Outputs (${result.unconstrainedOutputs.length})`);
    lines.push('| Port | Width | Module |');
    lines.push('|------|-------|--------|');
    for (const p of result.unconstrainedOutputs) {
      lines.push(`| \`${p.name}\` | ${p.width || 1} | ${p.module} |`);
    }
    lines.push('');
  }

  if (result.totalUnconstrained === 0) {
    lines.push('> ✅ 所有 top-level port 都有 constraint');
  }

  // Fix suggestions
  if (result.fixes && result.fixes.length > 0) {
    lines.push('## 💡 Fix Suggestions');

    const mismatches = result.fixes.filter(f => f.mismatch);
    if (mismatches.length > 0) {
      lines.push('### 🔧 Name Mismatches');
      lines.push('| RTL Port | SDC Port | 建議 |');
      lines.push('|----------|----------|------|');
      for (const f of mismatches) {
        lines.push(`| \`${f.port}\` | \`${f.mismatch.sdc}\` | 統一其中一個名稱 |`);
      }
      lines.push('');
    }

    const sdcFixes = result.fixes.filter(f => f.suggestedSdc);
    if (sdcFixes.length > 0) {
      lines.push('### 📝 SDC Template');
      lines.push('```sdc');
      for (const f of sdcFixes) {
        lines.push(f.suggestedSdc);
      }
      lines.push('```');
    }
  }

  lines.push('---');
  lines.push(`**Constrained:** ${result.totalConstrained} | **Unconstrained:** ${result.totalUnconstrained}`);

  return lines.join('\n');
}
