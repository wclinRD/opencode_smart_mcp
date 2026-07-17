/**
 * Synthesis Integration — Yosys wrapper for RTL analysis
 * 
 * 產生 synthesis report：resource utilization、area estimate、timing hint。
 * 
 * 依賴：
 * - Yosys (open-source synthesizer) — 必須安裝在 PATH 上
 * - 自動偵測 Yosys 是否可用，不可用時 fallback 到 regex 分析
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join, extname, basename } from 'path';
import { tmpdir } from 'os';

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run synthesis analysis on RTL files
 * @param {string} root - 專案根目錄
 * @param {Object} options - { top: string, files: string[], technology: string }
 * @returns {Object} Synthesis results
 */
export function analyzeSynth(root, options = {}) {
  const { top, files: fileList, technology = 'generic' } = options;

  // Detect Yosys
  const yosysAvailable = detectYosys();

  if (yosysAvailable) {
    return runYosysSynth(root, { top, files: fileList, technology });
  } else {
    return runFallbackAnalysis(root, { top, files: fileList });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Yosys Integration
// ═══════════════════════════════════════════════════════════════════════════

function detectYosys() {
  try {
    execSync('which yosys 2>/dev/null || where yosys 2>/dev/null', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runYosysSynth(root, options) {
  const { top, files: fileList, technology } = options;

  // Collect RTL files
  const rtlFiles = fileList || scanRtlFiles(root);
  if (rtlFiles.length === 0) {
    return { ok: false, error: 'No RTL files found', yosys: false };
  }

  // Determine top module
  const topModule = top || detectTopModule(rtlFiles);

  // Create temp filelist
  const tmpFile = join(tmpdir(), `yosys_synth_${Date.now()}.ys`);
  const jsonFile = join(tmpdir(), `yosys_synth_${Date.now()}.json`);

  try {
    // Build Yosys script
    const yosysScript = buildYosysScript(rtlFiles, topModule, jsonFile, technology);
    writeFileSync(tmpFile, yosysScript);

    // Run Yosys
    const yosysOutput = execSync(`yosys -q ${tmpFile} 2>&1`, {
      encoding: 'utf-8',
      timeout: 60000,
      cwd: root,
    });

    // Parse JSON output
    let design = null;
    try {
      const jsonContent = readFileSync(jsonFile, 'utf-8');
      design = JSON.parse(jsonContent);
    } catch {
      // JSON parse failed, use text output
    }

    // Parse utilization from text output
    const utilization = parseYosysOutput(yosysOutput);

    // Extract statistics from design JSON
    const stats = extractDesignStats(design);

    return {
      ok: true,
      yosys: true,
      topModule,
      technology,
      utilization,
      stats,
      cellCount: stats.totalCells || 0,
      wireCount: stats.totalWires || 0,
      portCount: stats.totalPorts || 0,
    };
  } catch (err) {
    return {
      ok: false,
      yosys: true,
      error: `Yosys synthesis failed: ${err.message}`,
      suggestion: 'Check RTL syntax and Yosys compatibility',
    };
  } finally {
    // Cleanup temp files
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(jsonFile); } catch {}
  }
}

function buildYosysScript(files, topModule, jsonFile, technology) {
  const lines = [];

  // Read files
  for (const f of files) {
    lines.push(`read_verilog ${f}`);
  }

  // Hierarchy
  if (topModule) {
    lines.push(`hierarchy -top ${topModule}`);
  }

  // Technology-specific synthesis
  switch (technology) {
    case 'asic':
      lines.push('synth -run begin:fine');
      lines.push('opt -fast');
      break;
    case 'fpga':
      lines.push('synth -top ' + (topModule || ''));
      break;
    default: // generic
      lines.push('synth');
  }

  // Statistics
  lines.push('stat');

  // Write JSON
  lines.push(`write_json ${jsonFile}`);

  return lines.join('\n');
}

function parseYosysOutput(output) {
  const result = {
    modules: 0,
    memories: 0,
    cells: {},
    wires: 0,
    processes: 0,
  };

  // Parse stat output
  const moduleMatch = output.match(/Number of modules:\s+(\d+)/);
  if (moduleMatch) result.modules = parseInt(moduleMatch[1]);

  const wireMatch = output.match(/Number of wires:\s+(\d+)/);
  if (wireMatch) result.wires = parseInt(wireMatch[1]);

  const cellMatch = output.match(/Number of cells:\s+(\d+)/);
  if (cellMatch) result.totalCells = parseInt(cellMatch[1]);

  // Parse cell types
  const cellTypeRe = /(\w+):\s+(\d+)/g;
  let match;
  while ((match = cellTypeRe.exec(output))) {
    result.cells[match[1]] = parseInt(match[2]);
  }

  return result;
}

function extractDesignStats(design) {
  if (!design) return {};

  const stats = {
    totalCells: 0,
    totalWires: 0,
    totalPorts: 0,
    cellTypes: {},
    modules: [],
  };

  if (design.modules) {
    for (const [name, mod] of Object.entries(design.modules)) {
      stats.modules.push(name);

      if (mod.cells) {
        const cellEntries = Object.entries(mod.cells);
        stats.totalCells += cellEntries.length;
        for (const [cellName, cell] of cellEntries) {
          const type = cell.type || 'unknown';
          stats.cellTypes[type] = (stats.cellTypes[type] || 0) + 1;
        }
      }

      if (mod.ports) {
        stats.totalPorts += Object.keys(mod.ports).length;
      }

      if (mod.netnames) {
        stats.totalWires += Object.keys(mod.netnames).length;
      }
    }
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fallback Analysis (No Yosys)
// ═══════════════════════════════════════════════════════════════════════════

function runFallbackAnalysis(root, options) {
  const { top, files: fileList } = options;
  const rtlFiles = fileList || scanRtlFiles(root);

  if (rtlFiles.length === 0) {
    return { ok: false, error: 'No RTL files found' };
  }

  const result = {
    ok: true,
    yosys: false,
    fallback: true,
    modules: [],
    totalRegs: 0,
    totalWires: 0,
    totalPorts: 0,
    estimatedLuts: 0,
  };

  for (const file of rtlFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const shortName = file.replace(/^.*\//, '');

      // Count modules
      const modules = content.match(/\bmodule\s+(\w+)/g) || [];
      for (const mod of modules) {
        const name = mod.replace(/\bmodule\s+/, '');
        result.modules.push({
          name,
          file: shortName,
          regs: countRegs(content),
          wires: countWires(content),
          ports: countPorts(content),
        });
      }

      result.totalRegs += countRegs(content);
      result.totalWires += countWires(content);
      result.totalPorts += countPorts(content);
    } catch {
      // skip
    }
  }

  // Rough LUT estimate: 1 LUT per 4 inputs
  result.estimatedLuts = Math.ceil(result.totalRegs * 1.5 + result.totalWires * 0.5);

  return result;
}

function countRegs(content) {
  const matches = content.match(/\breg\b\s+(?:\[.*?\]\s+)?(\w+)/g);
  return matches ? matches.length : 0;
}

function countWires(content) {
  const matches = content.match(/\bwire\b\s+(?:\[.*?\]\s+)?(\w+)/g);
  return matches ? matches.length : 0;
}

function countPorts(content) {
  const inputMatches = content.match(/\binput\b\s+/g) || [];
  const outputMatches = content.match(/\boutput\b\s+/g) || [];
  return inputMatches.length + outputMatches.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function scanRtlFiles(root) {
  const files = [];
  const exts = new Set(['.v', '.sv', '.vh', '.svh']);
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', 'build', 'dist']);

  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else if (exts.has(extname(entry))) files.push(full);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  walk(root);
  return files;
}

function detectTopModule(files) {
  // Try to find top module (largest file or first module)
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf-8');
      const match = content.match(/\bmodule\s+(\w+)\s*\(/);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export { detectYosys };
