/**
 * smart_medical_search — 免費醫學文獻與臨床證據查詢
 *
 * 多來源醫學查詢工具，完全免費：
 *   1. OpenEvidence（網頁端）— 直接查詢 OpenEvidence 公開端點，無需 API 金鑰
 *   2. PubMed API（NCBI E-utilities）— 3300 萬+ 醫學文獻
 *   3. OpenAlex — 2.5 億+ 學術作品，含引用數據
 *
 * OpenEvidence 模式使用其公開網頁 API（https://www.openevidence.com/api/ask），
 * 不需要 API 金鑰，但有 IP 速率限制（每天約數十次免費查詢）。
 * 如果 OpenEvidence 查詢失敗，會自動降級到 PubMed。
 */

const USER_AGENT = 'SmartMCP/1.0 (medical-search)';
const DEFAULT_TIMEOUT = 20000;

// ---------------------------------------------------------------------------
// OpenEvidence 公開端點（免金鑰，IP rate-limited）
// ---------------------------------------------------------------------------

/**
 * 透過 OpenEvidence 公開 API 查詢臨床問題
 * 使用 https://www.openevidence.com/api/ask 端點
 * 不需要 API 金鑰，但有 IP 速率限制
 */
async function searchOpenEvidence(question) {
  const url = 'https://www.openevidence.com/api/ask';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://www.openevidence.com',
      'Referer': 'https://www.openevidence.com/',
    },
    body: JSON.stringify({
      question,
      max_citations: 10,
      stream: false,
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!res.ok) {
    // 403 = rate limited / blocked
    if (res.status === 403 || res.status === 429) {
      return { ok: false, error: 'rate_limited', message: `OpenEvidence 免費額度已用完（HTTP ${res.status}），自動降級到 PubMed` };
    }
    throw new Error(`OpenEvidence API ${res.status}`);
  }

  const data = await res.json();
  return { ok: true, data };
}

/**
 * 格式化 OpenEvidence 結果
 */
function formatOpenEvidenceResult(data) {
  const lines = [];
  lines.push('=== 🏥 OpenEvidence 臨床證據查詢結果 ===');
  lines.push('');

  // 答案
  const answer = data.answer || data.text || '';
  if (answer) {
    lines.push('📋 答案：');
    lines.push(answer);
    lines.push('');
  }

  // 信心水準
  if (data.confidence !== undefined) {
    const pct = (data.confidence * 100).toFixed(0);
    const level = data.confidence > 0.7 ? '🟢 高' : data.confidence > 0.4 ? '🟡 中' : '🔴 低';
    lines.push(`📊 信心水準：${pct}%（${level}）`);
  }

  // 引用文獻
  const citations = data.citations || [];
  if (citations.length > 0) {
    lines.push('');
    lines.push(`📚 引用文獻（${citations.length} 篇）：`);
    citations.forEach((c, i) => {
      lines.push(`  [${i + 1}] ${c.title || '(無標題)'}`);
      if (c.source || c.journal) lines.push(`      來源：${c.source || c.journal}${c.year ? ` (${c.year})` : ''}`);
      if (c.authors?.length) lines.push(`      作者：${c.authors.slice(0, 3).join(', ')}${c.authors.length > 3 ? ' 等' : ''}`);
      if (c.doi || c.url) lines.push(`      🔗 ${c.doi || c.url}`);
      if (c.evidence_level) lines.push(`      證據等級：${c.evidence_level}`);
      lines.push('');
    });
  }

  // 免責聲明
  const disclaimers = data.disclaimers || [];
  if (disclaimers.length > 0) {
    lines.push('⚠️ 免責聲明：');
    disclaimers.forEach(d => lines.push(`  - ${d}`));
    lines.push('');
  }

  lines.push('📌 資料來源：OpenEvidence（免費公開端點，IP rate-limited）');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PubMed API（NCBI E-utilities，完全免費，無需金鑰）
// ---------------------------------------------------------------------------

async function searchPubMed(query, maxResults = 10) {
  // Step 1: ESearch
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`
    + `?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json&sort=relevance`;

  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!searchRes.ok) throw new Error(`PubMed search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const idList = searchData?.esearchresult?.idlist || [];
  if (idList.length === 0) return [];

  // Step 2: ESummary
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi`
    + `?db=pubmed&id=${idList.join(',')}&retmode=json`;

  const summaryRes = await fetch(summaryUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!summaryRes.ok) throw new Error(`PubMed summary failed: ${summaryRes.status}`);

  const summaryData = await summaryRes.json();
  const result = summaryData?.result || {};

  return idList.map(id => {
    const item = result[id];
    if (!item) return null;
    return {
      id,
      title: item.title || '(無標題)',
      authors: (item.authors || []).map(a => a.name).filter(Boolean),
      journal: item.source || '',
      year: item.pubdate ? extractYear(item.pubdate) : '',
      doi: item.elocationid || '',
      pmid: id,
      pubdate: item.pubdate || '',
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.pages || '',
      source: 'PubMed',
    };
  }).filter(Boolean);
}

function extractYear(pubdate) {
  const m = String(pubdate).match(/(\d{4})/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// OpenAlex API（免費，無需金鑰）
// ---------------------------------------------------------------------------

async function searchOpenAlex(query, maxResults = 10) {
  const url = `https://api.openalex.org/works`
    + `?search=${encodeURIComponent(query)}`
    + `&per_page=${Math.min(maxResults, 50)}`

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!res.ok) throw new Error(`OpenAlex search failed: ${res.status}`);

  const data = await res.json();
  const results = data?.results || [];

  return results.map(item => {
    const primaryLoc = item.primary_location || {};
    const source = primaryLoc.source || {};
    return {
      id: item.id,
      title: item.title || '(無標題)',
      authors: (item.authorships || []).map(a => a.author?.display_name).filter(Boolean),
      journal: source.display_name || '',
      year: item.publication_year || '',
      doi: item.doi || '',
      abstract: item.abstract_inverted_index ? reconstructAbstract(item.abstract_inverted_index) : '',
      citedByCount: item.cited_by_count || 0,
      source: 'OpenAlex',
      openAccess: item.open_access?.is_oa ? '✅ 開放存取' : '',
    };
  });
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 500);
}

// ---------------------------------------------------------------------------
// 格式化輸出
// ---------------------------------------------------------------------------

function formatPubMedResults(articles) {
  if (articles.length === 0) return '⚠️ PubMed 未找到相關文獻。';
  const lines = ['=== PubMed 醫學文獻查詢結果 ===', ''];
  articles.forEach((a, i) => {
    lines.push(`  [${i + 1}] ${a.title}`);
    if (a.authors.length > 0) lines.push(`      作者：${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 等' : ''}`);
    const journalInfo = [a.journal, a.year, a.volume, a.pages].filter(Boolean).join(', ');
    if (journalInfo) lines.push(`      期刊：${journalInfo}`);
    if (a.doi) lines.push(`      DOI：${a.doi}`);
    lines.push(`      PMID：${a.id}`);
    lines.push(`      🔗 https://pubmed.ncbi.nlm.nih.gov/${a.id}/`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatOpenAlexResults(articles) {
  if (articles.length === 0) return '⚠️ OpenAlex 未找到相關文獻。';
  const lines = ['=== OpenAlex 學術文獻查詢結果 ===', ''];
  articles.forEach((a, i) => {
    lines.push(`  [${i + 1}] ${a.title}`);
    if (a.authors.length > 0) lines.push(`      作者：${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 等' : ''}`);
    if (a.journal) lines.push(`      期刊：${a.journal} (${a.year})`);
    if (a.doi) lines.push(`      DOI：${a.doi}`);
    if (a.citedByCount) lines.push(`      被引用次數：${a.citedByCount}`);
    if (a.openAccess) lines.push(`      ${a.openAccess}`);
    if (a.abstract) lines.push(`      摘要：${a.abstract.slice(0, 300)}${a.abstract.length > 300 ? '...' : ''}`);
    lines.push('');
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 主要處理函式
// ---------------------------------------------------------------------------

async function medicalSearch(args = {}) {
  const action = String(args.action || 'auto').toLowerCase();
  const question = String(args.question || '').trim();
  const query = String(args.query || '').trim();
  const searchQuery = question || query;

  if (!searchQuery) {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    switch (action) {
      // ── 自動模式：先試 OpenEvidence，失敗降級到 PubMed ──
      case 'auto':
      case 'ask': {
        // 先試 OpenEvidence
        const oeResult = await searchOpenEvidence(searchQuery).catch(err => ({
          ok: false, error: 'failed', message: err.message,
        }));

        if (oeResult.ok) {
          return { ok: true, output: formatOpenEvidenceResult(oeResult.data) };
        }

        // OpenEvidence 失敗，降級到 PubMed
        const maxResults = args.maxResults || 10;
        const articles = await searchPubMed(searchQuery, maxResults);

        let output = `⚠️ OpenEvidence：${oeResult.message || '無法連線'}\n\n`;
        output += '⬇️ 自動降級到 PubMed 文獻搜尋：\n\n';
        output += formatPubMedResults(articles);

        return { ok: true, output };
      }

      // ── OpenEvidence 專用 ──
      case 'oe':
      case 'openevidence': {
        const oeResult = await searchOpenEvidence(searchQuery);
        if (!oeResult.ok) {
          // 降級提示
          const articles = await searchPubMed(searchQuery, args.maxResults || 10).catch(() => []);
          let output = `⚠️ OpenEvidence：${oeResult.message}\n\n`;
          output += '💡 建議改用 action=search（PubMed）或 action=all（綜合查詢）\n\n';
          if (articles.length > 0) {
            output += '⬇️ PubMed 替代結果：\n\n';
            output += formatPubMedResults(articles);
          }
          return { ok: true, output };
        }
        return { ok: true, output: formatOpenEvidenceResult(oeResult.data) };
      }

      // ── PubMed 文獻搜尋 ──
      case 'pubmed':
      case 'search': {
        const maxResults = args.maxResults || 10;
        const articles = await searchPubMed(searchQuery, maxResults);
        return { ok: true, output: formatPubMedResults(articles) };
      }

      // ── OpenAlex 學術搜尋 ──
      case 'openalex':
      case 'academic': {
        const maxResults = args.maxResults || 10;
        const articles = await searchOpenAlex(searchQuery, maxResults);
        return { ok: true, output: formatOpenAlexResults(articles) };
      }

      // ── 綜合查詢 ──
      case 'all':
      case 'comprehensive': {
        const maxResults = args.maxResults || 5;
        const [pubmed, openalex] = await Promise.all([
          searchPubMed(searchQuery, maxResults).catch(() => []),
          searchOpenAlex(searchQuery, maxResults).catch(() => []),
        ]);

        const parts = [
          `🔍 綜合醫學查詢：「${searchQuery}」`,
          '',
          formatPubMedResults(pubmed),
          '',
          formatOpenAlexResults(openalex),
          '',
          '📌 資料來源：OpenEvidence（免費公開端點）、PubMed（免費）、OpenAlex（免費）',
          '⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。',
        ];

        return { ok: true, output: parts.join('\n') };
      }

      default:
        return { ok: false, error: `未知的 action：${action}。支援：auto/ask, oe/openevidence, search/pubmed, openalex/academic, all/comprehensive` };
    }
  } catch (err) {
    return { ok: false, error: `醫學查詢失敗：${err.message}` };
  }
}

export default {
  name: 'smart_medical_search',
  category: 'standard',
  description: '免費醫學文獻與臨床證據查詢。完全免費，不需要任何 API 金鑰。\n\n'
    + '支援多種資料來源，自動降級：\n'
    + '  • OpenEvidence（公開端點）— 臨床證據問答，免金鑰，IP rate-limited\n'
    + '  • PubMed API（NCBI E-utilities）— 3300 萬+ 醫學文獻\n'
    + '  • OpenAlex — 2.5 億+ 學術作品，含引用數據\n\n'
    + '支援動作：\n'
    + '  action=auto（預設）/ ask：自動模式，先試 OpenEvidence，失敗降級到 PubMed\n'
    + '  action=oe / openevidence：強制使用 OpenEvidence\n'
    + '  action=search / pubmed：PubMed 文獻搜尋\n'
    + '  action=openalex / academic：OpenAlex 學術搜尋\n'
    + '  action=all / comprehensive：綜合查詢\n\n'
    + '完全免費，無需註冊或 API 金鑰。',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['auto', 'ask', 'oe', 'openevidence', 'search', 'pubmed', 'openalex', 'academic', 'all', 'comprehensive'],
        description: '查詢動作。auto/ask=自動模式（預設，先試 OpenEvidence 再降級），oe/openevidence=強制 OpenEvidence，search/pubmed=PubMed，openalex/academic=OpenAlex，all/comprehensive=綜合查詢',
      },
      question: {
        type: 'string',
        description: '醫學問題或關鍵字（例如："What is the recommended treatment for acute migraine in adults?"）',
      },
      query: {
        type: 'string',
        description: '查詢字串（question 的別名，兩者擇一提供）',
      },
      maxResults: {
        type: 'number',
        description: '最大結果數量（預設 10）',
      },
    },
  },
  handler: medicalSearch,
};
