/**
 * code — GitHub 程式碼搜尋（增強版）
 * 支援 ghr（免 token）+ GitHub API（需 token）+ Exa（免 token）三模式
 */
import { registerAction } from './registry.mjs';
import { searchGitHubCode } from '../sources/github.mjs';
import { searchExa } from '../sources/exa.mjs';
import { enhanceQueryForEDA } from '../query/enhance.mjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// EDA 工具 → GitHub repository 對應
const EDA_REPOS = {
  'yosys': 'YosysHQ/yosys',
  'openroad': 'The-OpenROAD-Project/OpenROAD',
  'openlane': 'The-OpenROAD-Project/OpenLane',
  'verilator': 'verilator/verilator',
  'icarus verilog': 'steveicarus/iverilog',
  'klayout': 'KLayout/klayout',
  'magic': 'RTimothyEdwards/magic',
};

const TOOL_ALIASES = {
  'yosys': ['yosys'],
  'openroad': ['openroad'],
  'openlane': ['openlane'],
  'verilator': ['verilator'],
  'icarus verilog': ['icarus', 'iverilog'],
  'klayout': ['klayout'],
  'magic': ['magic'],
};

/** 取得 ghr 工具路徑 */
function getGhrPath() {
  const home = process.env.HOME || '/tmp';
  const candidates = [
    path.join(home, '.local', 'bin', 'ghr'),
    '/usr/local/bin/ghr',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch {}
    }
  }
  return null;
}

/** 使用 ghr 搜尋程式碼（不需要 token） */
function searchWithGhr(ghrPath, repo, query, maxResults = 5) {
  try {
    const cmd = `"${ghrPath}" search ${repo} "${query}"`;
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const clean = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    const results = [];
    for (const line of clean.split('\n')) {
      const m = line.match(/│\s*(.+?)\s*│\s*(\d+)\s*│\s*(.+?)\s*│/);
      if (m) {
        const filePath = m[1].trim();
        const lineNum = parseInt(m[2]);
        results.push({
          name: path.basename(filePath),
          path: filePath,
          repo,
          url: `https://github.com/${repo}/blob/main/${filePath}#L${lineNum}`,
          score: 1.0,
          snippet: m[3].trim(),
        });
        if (results.length >= maxResults) break;
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** 偵測查詢中的 EDA 工具名稱 */
function detectTool(query) {
  const q = query.toLowerCase();
  for (const [tool, aliases] of Object.entries(TOOL_ALIASES)) {
    if (aliases.some(a => q.includes(a))) return tool;
  }
  return null;
}

/** 移除查詢中的工具名稱 */
function stripToolName(query) {
  return query.replace(/yosys|openroad|openlane|verilator|icarus|iverilog|klayout|magic/gi, '').trim();
}

/** 格式化搜尋結果 */
function formatResults(results) {
  if (!results || results.length === 0) return '🔍 GitHub 程式碼：無結果';
  let out = `🔍 GitHub 程式碼搜尋（${results.length} 筆）\n\n`;
  for (const r of results) {
    out += `### 📄 [${r.name}](${r.url})\n*Repo: ${r.repo} | Path: ${r.path}*\n`;
    if (r.snippet) out += `\n\`\`\`\n${r.snippet}\n\`\`\`\n`;
    out += '\n';
  }
  return out;
}

/** 安裝 ghr 工具 */
async function installGhr() {
  const home = process.env.HOME || '/tmp';
  const localBin = path.join(home, '.local', 'bin');
  const ghrPath = path.join(localBin, 'ghr');
  try {
    execSync(`mkdir -p "${localBin}"`, { stdio: 'ignore' });
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const url = `https://github.com/syxc/gh-repo-cli/releases/download/v0.2.3/ghr_v0.2.3_${platform}_${arch}.tar.gz`;
    execSync(`curl -sL "${url}" | tar xz -C "${localBin}"`, { stdio: 'ignore', timeout: 60000 });
    execSync(`chmod +x "${ghrPath}"`, { stdio: 'ignore' });
    execSync(`"${ghrPath}" --version`, { stdio: 'ignore' });
    return ghrPath;
  } catch {
    return null;
  }
}

/** 確保 ghr 可用 */
async function ensureGhr() {
  return getGhrPath() || await installGhr();
}

registerAction('code', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = Math.min(args.maxResults || 10, 5);
  const hasToken = !!process.env.GITHUB_TOKEN;
  const ghrPath = await ensureGhr();

  // 偵測 EDA 工具
  const tool = detectTool(searchQuery);
  const targetRepo = tool ? EDA_REPOS[tool] : null;

  // 路徑 1: ghr 搜尋（免 token）
  if (ghrPath && targetRepo) {
    const query = stripToolName(searchQuery) || searchQuery;
    const results = searchWithGhr(ghrPath, targetRepo, query, maxResults);
    if (results.length > 0) {
      return { ok: true, output: formatResults(results) };
    }
  }

  // 路徑 2: GitHub API（需要 token）
  if (hasToken) {
    const allResults = [];
    const seenRepos = new Set();
    const queries = [
      `${searchQuery} language:tcl`,
      `${searchQuery} language:python`,
      `${searchQuery} language:verilog`
    ];
    for (const q of queries) {
      try {
        const results = await searchGitHubCode(enhanceQueryForEDA(q), Math.min(maxResults, 3));
        for (const r of results) {
          const key = `${r.repo}/${r.path}`;
          if (!seenRepos.has(key)) { seenRepos.add(key); allResults.push(r); }
        }
        if (allResults.length >= maxResults) break;
      } catch {}
    }
    if (allResults.length > 0) {
      return { ok: true, output: formatResults(allResults.slice(0, maxResults)) };
    }
  }

  // 路徑 3: Exa 搜尋（免 token）
  try {
    const exaQuery = `site:github.com ${searchQuery} (SDC OR constraints OR clock OR timing)`;
    const exaResults = await searchExa(exaQuery, maxResults);
    if (exaResults.length > 0) {
      const formatted = exaResults.map(r => ({
        name: r.title?.split('/').pop() || '',
        path: r.url || '',
        repo: r.title?.replace(/^\[.*?\]\s*/, '') || '',
        url: r.url || '',
        score: r.score || 0,
        snippet: r.snippet || '',
      }));
      return { ok: true, output: formatResults(formatted) };
    }
  } catch (err) {
    console.log(`[Code] Exa fallback error: ${err.message}`);
  }

  // 路徑 4: 回傳建議
  const toolLinks = Object.entries(EDA_REPOS).map(([t, r]) => `• ${t}: https://github.com/${r}`).join('\n');
  return {
    ok: true,
    output: `⚠️ GitHub Code Search：無結果\n\n` +
            `💡 建議：\n` +
            `1. 設定 GITHUB_TOKEN 環境變數以啟用程式碼搜尋\n` +
            `2. 或直接使用 \`smart_exa_search\` 進行語意搜尋：\n` +
            `   \`smart_exa_search({command:"code", query:"${searchQuery}", numResults:10})\`\n` +
            `3. 或直接瀏覽 EDA 工具 repositories：\n${toolLinks}`
  };
});
