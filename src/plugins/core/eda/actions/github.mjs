/**
 * github — GitHub EDA 專案搜尋
 */
import { registerAction } from './registry.mjs';
import { searchGitHubEDA, formatGitHubResults } from '../sources/github.mjs';

registerAction('github', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  const results = await searchGitHubEDA(searchQuery, maxResults);
  return { ok: true, output: formatGitHubResults(results, 'GitHub EDA 專案') };
});
