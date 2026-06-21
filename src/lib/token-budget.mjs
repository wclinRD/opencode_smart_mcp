// token-budget.mjs — Token budget compression for search results
//
// Three compression levels:
//   L0: signature only (file:line: matched text, ~15 tokens/result)
//   L1: +3 lines context + scope (~80-120 tokens/result)
//   L2: full match details as normal (~200-800 tokens/result)
//
// Also supports greedy token budget fitting: fitToBudget(results, maxTokens)

// Rough token estimation: ~4 chars per token for English text, ~3 for code
export function estimateTokens(text) {
  if (!text) return 0;
  // For code, ~3.5 chars/token is reasonable (code is denser than prose)
  return Math.ceil(text.length / 3.5);
}

/**
 * Format a single match result at the given compression level.
 * @param {object} fileResult — file-level result object
 * @param {object} match — individual match within fileResult.matches
 * @param {string} level — 'L0' | 'L1' | 'L2'
 * @param {object} [opts]
 * @param {boolean} [opts.color] — include ANSI color
 * @returns {string} formatted string
 */
export function formatMatch(fileResult, match, level, opts = {}) {
  const relFile = fileResult.relFile || fileResult.file;
  const line = match.line || 0;

  switch (level) {
    case 'L0': {
      // file:line: matched text (compact, ~15 tokens)
      const text = (match.matchedText || match.lineContent || '').trim().substring(0, 80);
      return `${relFile}:${line}: ${text}`;
    }
    case 'L1': {
      // file header + match line + 3 context lines + scope
      const parts = [`━━━ ${relFile}:${line}`];
      if (match.scopeName) {
        parts.push(`  ∈ ${match.scopeName}`);
      }
      // Context before (up to 3 lines)
      const ctxBefore = (match.contextBefore || []).slice(-3);
      for (const ctx of ctxBefore) {
        parts.push(`  ${ctx}`);
      }
      // Match line
      parts.push(`  → ${(match.lineContent || '').trim()}`);
      // Context after (up to 3 lines)
      const ctxAfter = (match.contextAfter || []).slice(0, 3);
      for (const ctx of ctxAfter) {
        parts.push(`  ${ctx}`);
      }
      return parts.join('\n');
    }
    case 'L2':
    default:
      // Full format: file header + all context + scope
      return formatFullMatch(fileResult, match, opts);
  }
}

/**
 * Format a single result at full detail (L2).
 */
function formatFullMatch(fileResult, match, opts) {
  const relFile = fileResult.relFile || fileResult.file;
  const parts = [`━━━ ${relFile}:${match.line}`];

  if (match.scopeName) {
    parts.push(`  ∈ ${match.scopeName} (line ${match.scopeStartLine || '?'})`);
  }

  // Context before
  for (const ctx of match.contextBefore || []) {
    parts.push(`  ${ctx}`);
  }

  // Match line
  const matched = (match.lineContent || '').trim();
  parts.push(`  → ${matched}`);

  // Context after
  for (const ctx of match.contextAfter || []) {
    parts.push(`  ${ctx}`);
  }

  return parts.join('\n');
}

/**
 * Compress an array of search results at the given level.
 * @param {Array} results — array of file results (each with .matches[])
 * @param {string} level — 'L0' | 'L1' | 'L2'
 * @param {object} [opts]
 * @returns {Array} compressed results array
 */
export function compressLevel(results, level, opts = {}) {
  if (!results || results.length === 0) return results;
  if (level === 'L2') return results; // L2 = no compression, return as-is

  const compressed = [];

  for (const fileResult of results) {
    if (!fileResult.matches || fileResult.matches.length === 0) {
      // countOnly-style results: just keep the file line
      compressed.push(`${fileResult.relFile || fileResult.file}: ${fileResult.matchCount || 0} matches`);
      continue;
    }

    for (const match of fileResult.matches) {
      compressed.push(formatMatch(fileResult, match, level, opts));
    }
  }

  return compressed;
}

/**
 * Greedily fit compressed results into a token budget.
 * Selects highest-relevance results first until budget is exhausted.
 * @param {Array} results — raw search results
 * @param {number} maxTokens — maximum token budget
 * @param {string} level — compression level ('L0' | 'L1' | 'L2')
 * @param {object} [opts]
 * @returns {{ text: string, selected: number, total: number, tokensUsed: number }}
 */
export function fitToBudget(results, maxTokens, level = 'L1', opts = {}) {
  if (!results || results.length === 0 || maxTokens <= 0) {
    return { text: '', selected: 0, total: 0, tokensUsed: 0 };
  }

  // Collect all individual match entries
  const entries = [];
  for (const fileResult of results) {
    if (!fileResult.matches || fileResult.matches.length === 0) {
      entries.push({
        fileResult,
        match: null,
        score: fileResult.score || fileResult.relevance || 0,
      });
      continue;
    }
    for (const match of fileResult.matches) {
      entries.push({
        fileResult,
        match,
        score: match.score || match.relevance || fileResult.score || 0,
      });
    }
  }

  // Sort by score descending (higher = more relevant)
  entries.sort((a, b) => b.score - a.score);

  const selected = [];
  let tokensUsed = 0;

  for (const entry of entries) {
    const formatted = entry.match
      ? formatMatch(entry.fileResult, entry.match, level, opts)
      : `${entry.fileResult.relFile || entry.fileResult.file}: ${entry.fileResult.matchCount || 0} matches`;

    const estimatedTokens = estimateTokens(formatted) + 1; // +1 for newline
    if (tokensUsed + estimatedTokens > maxTokens) {
      continue; // Skip entries that don't fit
    }

    selected.push(formatted);
    tokensUsed += estimatedTokens;
  }

  return {
    text: selected.join('\n'),
    selected: selected.length,
    total: entries.length,
    tokensUsed,
  };
}

export default { estimateTokens, formatMatch, compressLevel, fitToBudget };
