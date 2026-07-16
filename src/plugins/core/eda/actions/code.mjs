/**
 * code — GitHub 程式碼搜尋
 */
import { registerAction } from './registry.mjs';
import { searchGitHubCode } from '../sources/github.mjs';

registerAction('code', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = Math.min(args.maxResults || 10, 5);
  const results = await searchGitHubCode(searchQuery, maxResults);
  if (!results || results.length === 0) {
    return { ok: true, output: '🔍 GitHub 程式碼：無結果\n' };
  }
  let out = `🔍 GitHub 程式碼搜尋（${results.length} 筆）\n\n`;
  for (const r of results) {
    out += `### 📄 [${r.name}](${r.url})\n`;
    out += `*Repo: ${r.repo} | Path: ${r.path}*\n\n`;
  }
  return { ok: true, output: out };
});
