/**
 * all/comprehensive — 綜合搜尋（本地索引 + 多源並行）
 */
import { registerAction } from './registry.mjs';
import { searchLocalPDK, formatPDKResults, searchLocalTools, formatToolResults } from '../format/local.mjs';
import { multiSourceSearch } from '../sources/index.mjs';

registerAction('all', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  let output = '';
  // 先搜本地索引
  const localPDK = searchLocalPDK(searchQuery);
  if (localPDK.length > 0) output += formatPDKResults(localPDK);
  const localTools = searchLocalTools(searchQuery);
  if (localTools.length > 0) output += formatToolResults(localTools);
  // 多源並行搜尋
  const compress = args.compress || 'none';
  output += await multiSourceSearch(searchQuery, maxResults, { compress });
  return { ok: true, output: output || '🔍 綜合搜尋：未找到結果' };
}, ['comprehensive']);
