/**
 * CDC (Clock Domain Crossing) Detector
 * 
 * 偵測跨時鐘域信號，分析 synchronizer 需求。
 * 
 * 策略：
 * 1. 從 RTL 程式碼中自動辨識 clock domain（always @posedge clk / negedge clk）
 * 2. 追蹤每個 signal 屬於哪個 clock domain
 * 3. 偵測跨 domain 的 signal 連接
 * 4. 檢查是否有 synchronizer（2-FF chain）
 * 5. 產生 CDC 報告 + 修復建議
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 分析 CDC — 從 RTL 原始碼偵測時鐘域跨越
 * @param {string} root - 專案根目錄
 * @param {string[]} files - RTL 檔案路徑（可選，自動掃描）
 * @returns {Object} CDC 分析結果
 */
export function analyzeCdc(root, files = null) {
  const rtlFiles = files || scanRtlFiles(root);
  if (rtlFiles.length === 0) {
    return { ok: false, error: 'No RTL files found', clockDomains: [], crossings: [], synchronizers: [] };
  }

  // Step 1: 讀取所有 RTL 檔案
  const sourceMap = new Map(); // file → lines
  for (const f of rtlFiles) {
    try {
      const content = readFileSync(f, 'utf-8');
      sourceMap.set(f, content.split('\n'));
    } catch {
      // skip unreadable files
    }
  }

  // Step 2: 辨識 clock domain
  const clockDomains = detectClockDomains(sourceMap);

  // Step 3: 追蹤 signal 到 clock domain
  const signalDomainMap = assignSignalsToDomains(sourceMap, clockDomains);

  // Step 4: 偵測跨 domain 連接
  const crossings = detectCrossings(sourceMap, signalDomainMap, clockDomains);

  // Step 5: 檢查 synchronizer
  const synchronizers = findSynchronizers(sourceMap, crossings);

  // Step 6: 計算統計
  const stats = {
    totalFiles: rtlFiles.length,
    clockDomainCount: clockDomains.length,
    crossingCount: crossings.length,
    synchronizedCount: synchronizers.length,
    unsynchronizedCount: crossings.filter(c => !c.hasSynchronizer).length,
  };

  return {
    ok: true,
    clockDomains,
    crossings,
    synchronizers,
    signalDomainMap: Object.fromEntries(signalDomainMap),
    stats,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Clock Domain Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 從 RTL 程式碼中偵測 clock domain
 * 
 * 支援：
 * - always @(posedge clk) → posedge domain
 * - always @(negedge clk) → negedge domain
 * - always @(posedge clk or negedge rst_n) → posedge domain
 * - assign sig = clk_div / 2 分頻 → 分頻 domain
 */
function detectClockDomains(sourceMap) {
  const domains = [];
  const seen = new Set();

  // Clock edge pattern
  const edgePattern = /always\s*@\s*\(\s*(posedge|negedge)\s+(\w+)/g;

  for (const [file, lines] of sourceMap) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      while ((match = edgePattern.exec(line))) {
        const edge = match[1]; // posedge / negedge
        const clock = match[2]; // clk / clk_a / etc.

        // Skip reset signals
        if (isResetSignal(clock)) continue;

        const key = `${edge}:${clock}`;
        if (!seen.has(key)) {
          seen.add(key);
          domains.push({
            name: clock,
            edge,
            displayName: `${edge} ${clock}`,
            file: shortPath(file),
            line: i + 1,
          });
        }
      }
    }
  }

  // Deduplicate by clock name (keep posedge if both exist)
  const byClock = new Map();
  for (const d of domains) {
    if (!byClock.has(d.name)) {
      byClock.set(d.name, d);
    } else {
      // Keep the one with more occurrences
    }
  }

  return [...byClock.values()];
}

// ═══════════════════════════════════════════════════════════════════════════
// Signal → Domain Assignment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 將 signal 分配到 clock domain
 * 
 * 規則：
 * - always @(posedge clk) 內的 reg → belong to clk domain
 * - assign 到 reg 的 signal → 來自源頭 clock domain
 * - input port → 外部 domain（需 CDC check）
 */
function assignSignalsToDomains(sourceMap, clockDomains) {
  const signalDomains = new Map(); // signal → domain

  // Pattern: detect reg declarations
  const regPattern = /\breg\b\s+(?:\[.*?\]\s+)?(\w+)/g;

  // Pattern: detect wire assignments from always blocks
  const alwaysBlockPattern = /always\s*@\s*\(\s*(posedge|negedge)\s+(\w+)[\s\S]*?\)\s*([\s\S]*?)(?=always\s|endmodule|$)/g;

  for (const [file, lines] of sourceMap) {
    const content = lines.join('\n');

    // Find always blocks and their clock domains
    let blockMatch;
    const blockPattern = /always\s*@\s*\(\s*(posedge|negedge)\s+(\w+)[\s\S]*?\)\s*(begin[\s\S]*?)(?=always\s|endmodule|$)/g;
    while ((blockMatch = blockPattern.exec(content))) {
      const edge = blockMatch[1];
      const clock = blockMatch[2];
      if (isResetSignal(clock)) continue;

      const blockBody = blockMatch[3];

      // Find all reg assignments in this block
      const assignPattern = /(\w+)\s*(?:<=|=)\s*/g;
      let assignMatch;
      while ((assignMatch = assignPattern.exec(blockBody))) {
        const sig = assignMatch[1];
        if (!isKeyword(sig)) {
          signalDomains.set(sig, clock);
        }
      }
    }

    // Detect reg declarations
    let regMatch;
    while ((regMatch = regPattern.exec(content))) {
      const sig = regMatch[1];
      if (!isKeyword(sig)) {
        // Default: mark as 'combinational' if no domain found
        if (!signalDomains.has(sig)) {
          signalDomains.set(sig, 'combinational');
        }
      }
    }
  }

  return signalDomains;
}

// ═══════════════════════════════════════════════════════════════════════════
// Crossing Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 偵測跨時鐘域連接
 * 
 * 規則：
 * - assign y = x; where x in domain A, y in domain B → crossing
 * - Instance port connections across domains
 * - Combinational logic connecting different domains
 */
function detectCrossings(sourceMap, signalDomainMap, clockDomains) {
  const crossings = [];
  const seen = new Set();

  // Pattern: continuous assignment
  const assignPattern = /\bassign\s+(\w+)\s*=\s*(.+?)\s*;/g;

  // Pattern: module instantiation port connections
  const instPattern = /\.(\w+)\s*\(\s*(\w+)\s*\)/g;

  for (const [file, lines] of sourceMap) {
    const content = lines.join('\n');

    // Check continuous assignments
    let match;
    const assignRe = /\bassign\s+(\w+)\s*=\s*(.+?)\s*;/g;
    while ((match = assignRe.exec(content))) {
      const dest = match[1];
      const src = match[2];

      const destDomain = signalDomainMap.get(dest);
      const srcDomain = signalDomainMap.get(src);

      if (destDomain && srcDomain && destDomain !== srcDomain && destDomain !== 'combinational' && srcDomain !== 'combinational') {
        const key = `${src}:${srcDomain}->${dest}:${destDomain}`;
        if (!seen.has(key)) {
          seen.add(key);
          crossings.push({
            source: src,
            sourceDomain: srcDomain,
            dest: dest,
            destDomain: destDomain,
            type: 'continuous_assign',
            file: shortPath(file),
            line: findLine(lines, match.index),
          });
        }
      }
    }

    // Check always block assignments
    const alwaysRe = /always\s*@\s*\(\s*(posedge|negedge)\s+(\w+)[\s\S]*?\)\s*begin([\s\S]*?)end/g;
    let alwaysMatch;
    while ((alwaysMatch = alwaysRe.exec(content))) {
      const clock = alwaysMatch[2];
      if (isResetSignal(clock)) continue;

      const blockBody = alwaysMatch[3];
      const assignInBlock = /(\w+)\s*<=\s*(\w+)/g;
      let aMatch;
      while ((aMatch = assignInBlock.exec(blockBody))) {
        const dest = aMatch[1];
        const src = aMatch[2];
        const srcDomain = signalDomainMap.get(src);

        if (srcDomain && srcDomain !== clock && srcDomain !== 'combinational') {
          const key = `${src}:${srcDomain}->${dest}:${clock}`;
          if (!seen.has(key)) {
            seen.add(key);
            crossings.push({
              source: src,
              sourceDomain: srcDomain,
              dest: dest,
              destDomain: clock,
              type: 'always_block',
              file: shortPath(file),
              line: findLine(lines, alwaysMatch.index + aMatch.index),
            });
          }
        }
      }
    }
  }

  return crossings;
}

// ═══════════════════════════════════════════════════════════════════════════
// Synchronizer Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 檢查 crossing 是否有 synchronizer
 * 
 * Synchronizer patterns:
 * - 2-FF chain: always @(posedge clk_b) q1 <= src; always @(posedge clk_b) q2 <= q1;
 * - Handshake protocol: req/ack
 * - Async FIFO
 */
function findSynchronizers(sourceMap, crossings) {
  const synchronizers = [];

  // Detect 2-FF synchronizer patterns
  const ffChainPattern = /(\w+_sync\d*)\s*(?:<=|=)\s*(\w+)/g;
  const ffPattern = /\b(\w+_ff\d*)\s*(?:<=|=)\s*(\w+)/g;

  for (const [file, lines] of sourceMap) {
    const content = lines.join('\n');

    // Detect sync chain: q1 <= src; q2 <= q1;
    const syncChainRe = /(\w+)\s*(?:<=|=)\s*(\w+)[\s\S]*?(\w+)\s*(?:<=|=)\s*\1/g;
    let syncMatch;
    while ((syncMatch = syncChainRe.exec(content))) {
      const src = syncMatch[2];
      const ff1 = syncMatch[1];
      const ff2 = syncMatch[3];

      // Check if this is a crossing source
      for (const c of crossings) {
        if (c.source === src && !c.hasSynchronizer) {
          synchronizers.push({
            crossing: `${c.source} → ${c.dest}`,
            type: '2-ff-chain',
            ffs: [ff1, ff2],
            file: shortPath(file),
          });
          c.hasSynchronizer = true;
        }
      }
    }

    // Detect _sync suffix naming
    const syncSuffixRe = /(\w+_sync)\s*(?:<=|=)\s*(\w+)/g;
    let syncSuffixMatch;
    while ((syncSuffixMatch = syncSuffixRe.exec(content))) {
      const syncReg = syncSuffixMatch[1];
      const src = syncSuffixMatch[2];

      for (const c of crossings) {
        if (c.source === src && !c.hasSynchronizer) {
          synchronizers.push({
            crossing: `${c.source} → ${c.dest}`,
            type: 'sync-suffix',
            syncReg,
            file: shortPath(file),
          });
          c.hasSynchronizer = true;
        }
      }
    }

    // Detect handshake pattern (req/ack)
    const handshakeRe = /(\w+_req)\s*(?:<=|=)[\s\S]*?(\w+_ack)\s*(?:<=|=)/g;
    let hsMatch;
    while ((hsMatch = handshakeRe.exec(content))) {
      synchronizers.push({
        crossing: `${hsMatch[1]} / ${hsMatch[2]}`,
        type: 'handshake',
        file: shortPath(file),
      });
    }
  }

  // Mark crossings without synchronizers
  for (const c of crossings) {
    if (!c.hasSynchronizer) {
      c.risk = 'high';
      c.suggestion = generateCdcFixSuggestion(c);
    } else {
      c.risk = 'low';
    }
  }

  return synchronizers;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix Suggestions
// ═══════════════════════════════════════════════════════════════════════════

function generateCdcFixSuggestion(crossing) {
  const { source, sourceDomain, dest, destDomain } = crossing;

  return {
    type: '2-ff-synchronizer',
    code: `// 2-FF Synchronizer: ${source} (${sourceDomain}) → ${dest} (${destDomain})\n` +
          `reg ${source}_sync1;\n` +
          `reg ${source}_sync2;\n` +
          `always @(posedge ${destDomain}) begin\n` +
          `  ${source}_sync1 <= ${source};\n` +
          `  ${source}_sync2 <= ${source}_sync1;\n` +
          `end\n` +
          `// Then use ${source}_sync2 instead of ${source} in ${destDomain} domain`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function scanRtlFiles(root) {
  const files = [];
  const exts = new Set(['.v', '.sv', '.vh', '.svh', '.vhd', '.vhdl']);
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', 'build', 'dist']);

  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full);
          } else if (exts.has(extname(entry))) {
            files.push(full);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  walk(root);
  return files;
}

function shortPath(file) {
  return file.replace(/^.*\//, '');
}

function findLine(lines, charIndex) {
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    pos += lines[i].length + 1; // +1 for \n
    if (pos > charIndex) return i + 1;
  }
  return lines.length;
}

function isResetSignal(name) {
  const resets = ['rst', 'rst_n', 'reset', 'reset_n', 'arst', 'arst_n', 'i_rst', 'i_rst_n'];
  return resets.some(r => name === r || name.toLowerCase().includes(r));
}

function isKeyword(name) {
  const keywords = ['assign', 'input', 'output', 'wire', 'reg', 'begin', 'end', 'if', 'else', 'case', 'endcase', 'module', 'endmodule', 'always', 'posedge', 'negedge'];
  return keywords.includes(name);
}

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

export { detectClockDomains, assignSignalsToDomains, detectCrossings, findSynchronizers };
