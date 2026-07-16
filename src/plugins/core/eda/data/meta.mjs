/**
 * EDA 元資料：會議、社群、格式、指令索引
 * 純資料從 meta.json 載入；RegExp/函式保留在此
 */

import metaJson from './meta.json' with { type: 'json' };
export const EDA_CONFERENCES = metaJson.EDA_CONFERENCES;
export const EDA_FORMATS = metaJson.EDA_FORMATS;

// ── EDA Community 索引（含 queryTemplate 函式，不可 JSON 化）──
export const EDA_COMMUNITIES = [
  { name: 'Cadence Community', domain: 'community.cadence.com', tier: 1, queryTemplate: (q) => `site:community.cadence.com ${q}` },
  { name: 'Synopsys SolvNet', domain: 'solvnet.synopsys.com', tier: 1, queryTemplate: (q) => `site:solvnet.synopsys.com ${q}` },
  { name: 'EE Times', domain: 'eetimes.com', tier: 2, queryTemplate: (q) => `site:eetimes.com EDA ASIC ${q}` },
  { name: 'Reddit r/ASIC', domain: 'reddit.com/r/ASIC', tier: 2, queryTemplate: (q) => `site:reddit.com/r/ASIC ${q}` },
  { name: 'Reddit r/FPGA', domain: 'reddit.com/r/FPGA', tier: 2, queryTemplate: (q) => `site:reddit.com/r/FPGA ${q}` },
  { name: 'EDAboard', domain: 'edaboard.com', tier: 2, queryTemplate: (q) => `site:edaboard.com ${q}` },
  { name: 'ChipVerify', domain: 'chipverify.com', tier: 2, queryTemplate: (q) => `site:chipverify.com ${q}` },
  { name: 'Verification Academy', domain: 'verificationacademy.com', tier: 2, queryTemplate: (q) => `site:verificationacademy.com ${q}` },
];

// ── Auto 模式：偵測 tool 問題查詢的 pattern（RegExp，不可 JSON 化）──
export const TOOL_ISSUE_PATTERNS = [
  /error/i, /issue/i, /problem/i, /fail/i, /not found/i,
  /cannot/i, /can't/i, /unable/i, /missing/i, /undefined/i,
  /violation/i, /mismatch/i, /conflict/i, /exception/i,
  /bug/i, /crash/i, /hang/i, /stuck/i, /timeout/i,
  /help/i, /fix/i, /solve/i, /debug/i, /troubleshoot/i,
  /warning/i, /not met/i, /critical/i, /concern/i,
  /improve/i, /optimize/i, /degraded/i, /slow/i,
  /incorrect/i, /wrong/i, /unexpected/i, /strange/i,
  /refuse/i, /reject/i, /ignore/i, /skip/i,
];
