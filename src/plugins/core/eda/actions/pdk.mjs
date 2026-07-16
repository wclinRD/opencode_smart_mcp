/**
 * pdk — PDK / Cell Library 查詢
 */
import { registerAction } from './registry.mjs';
import { searchLocalPDK, formatPDKResults } from '../format/local.mjs';
import { searchGitHubPDK, formatGitHubResults } from '../sources/github.mjs';

registerAction('pdk', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  const localPDK = searchLocalPDK(searchQuery);
  let output = formatPDKResults(localPDK);
  try {
    const ghResults = await searchGitHubPDK(searchQuery, maxResults);
    output += '\n' + formatGitHubResults(ghResults, 'GitHub PDK 相關專案');
  } catch { /* ignore */ }
  return { ok: true, output };
});
