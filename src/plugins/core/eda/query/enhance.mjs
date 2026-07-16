// ── 查詢增強 + 展開 ─────────────────────────────────────────────────────
import { EDA_ABBREVIATIONS, PATTERN_RULES, expandAbbreviations, EDA_ABBREV_DICT } from '../data/abbreviations.mjs';
import { EDA_CONFERENCES } from '../data/meta.mjs';

export function enhanceQueryForEDA(query) {
  // Phase 11 Step 1: 縮寫展開
  const { expanded: expandedQuery, abbreviations } = expandAbbreviations(query);

  const edaKeywords = ['synthesis', 'placement', 'routing', 'timing', 'clock tree', 'floorplan',
    'P&R', 'STA', 'DRC', 'LVS', 'PDK', 'standard cell', 'RTL', 'GDSII', 'netlist',
    'EDA', 'VLSI', 'ASIC', 'FPGA', 'FinFET', 'CMOS', 'liberty', '.lib', 'characterize',
    'clock mux', 'CDC', 'metastability', 'synchronizer', 'UPF', 'power domain',
    'multi-cycle', 'false path', 'clock gating', 'OCV', 'AOCV', 'POCV'];
  const hasEDAKeyword = edaKeywords.some(k => expandedQuery.toLowerCase().includes(k.toLowerCase()));
  if (hasEDAKeyword) return expandedQuery;
  return `${expandedQuery} VLSI EDA IC design`;
}

export function generateQueryVariants(originalQuery, maxVariants = 3) {
  const variants = [originalQuery];
  const q = originalQuery.toLowerCase();
  const words = q.split(/\s+/);
  const expandedWords = words.map(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '');
    return EDA_ABBREVIATIONS[clean] || w;
  });
  const expanded = expandedWords.join(' ');
  if (expanded !== q) variants.push(originalQuery.replace(new RegExp(words.join('|'), 'gi'), (m) => EDA_ABBREVIATIONS[m.toLowerCase()] || m));

  let patternExpanded = originalQuery;
  let hasPattern = false;
  for (const rule of PATTERN_RULES) {
    if (rule.pattern.test(patternExpanded)) {
      patternExpanded = patternExpanded.replace(rule.pattern, rule.expand);
      hasPattern = true;
      rule.pattern.lastIndex = 0;
    }
  }
  if (hasPattern && patternExpanded !== originalQuery) variants.push(patternExpanded);

  if (q.includes('mux') || q.includes('clock')) variants.push(`${originalQuery} glitch-free`);
  if (q.includes('setup') || q.includes('hold')) variants.push(`${originalQuery} timing violation`);
  if (q.includes('liberty') || q.includes('.lib')) variants.push(`${originalQuery} characterization NLDM`);

  return [...new Set(variants)].slice(0, maxVariants);
}

export function generateSearchQueries(originalQuery, context = 'general') {
  const q = originalQuery.toLowerCase();
  const queries = { web: '', community: '', academic: '', github: '' };
  const base = originalQuery;

  if (q.includes('error') || q.includes('fail') || q.includes('問題') || q.includes('fix')
    || q.includes('violation') || q.includes('warning')) {
    queries.web = `${base} EDA solution fix troubleshooting`;
  } else if (q.includes('how to') || q.includes('怎么') || q.includes('如何') || q.includes('方法')) {
    queries.web = `${base} EDA methodology best practice`;
  } else if (q.includes('what is') || q.includes('是什麼') || q.includes('概念')) {
    queries.web = `${base} EDA explanation tutorial`;
  } else {
    queries.web = `${base} EDA ASIC IC design`;
  }

  queries.community = base;

  if (q.includes('theory') || q.includes('原理') || q.includes('algorithm')) {
    queries.academic = `${base} VLSI ASIC theoretical analysis`;
  } else if (q.includes('compare') || q.includes('比較') || q.includes('vs')) {
    queries.academic = `${base} VLSI ASIC comparison survey`;
  } else {
    queries.academic = `${base} VLSI ASIC survey analysis`;
  }

  if (q.includes('script') || q.includes('flow') || q.includes('script')) {
    queries.github = `${base} script automation`;
  } else if (q.includes('liberty') || q.includes('.lib') || q.includes('timing')) {
    queries.github = `${base} liberty characterization script`;
  } else {
    queries.github = `${base} tool flow example`;
  }

  return queries;
}

export function detectConference(query) {
  const q = query.toUpperCase();
  for (const conf of EDA_CONFERENCES) {
    if (q.includes(conf.toUpperCase())) return conf;
  }
  return null;
}
