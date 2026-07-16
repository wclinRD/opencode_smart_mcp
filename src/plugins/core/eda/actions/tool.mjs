/**
 * tool/tools — EDA 工具文件搜尋
 */
import { registerAction } from './registry.mjs';
import { searchLocalTools, formatToolResults } from '../format/local.mjs';
import { searchGitHubEDA, formatGitHubResults } from '../sources/github.mjs';

registerAction('tool', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  const localTools = searchLocalTools(searchQuery);
  let output = formatToolResults(localTools);
  try {
    const ghResults = await searchGitHubEDA(searchQuery, maxResults);
    output += '\n' + formatGitHubResults(ghResults, 'GitHub EDA 工具');
  } catch { /* ignore */ }
  return { ok: true, output };
}, ['tools']);
