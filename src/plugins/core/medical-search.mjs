/**
 * smart_medical_search — 免費醫學文獻與臨床證據查詢（增強版 v2）
 *
 * 多來源醫學查詢工具，完全免費，不需要 API 金鑰：
 *   1. OpenEvidence（公開端點）— 臨床證據問答，IP rate-limited
 *   2. PubMed API（NCBI E-utilities）— 3700 萬+ 醫學文獻，含 abstract + MeSH
 *   3. OpenAlex — 2.5 億+ 學術作品，含引用數據 + abstract
 *   4. Semantic Scholar — 2 億+ 論文，TLDR 摘要 + 引用圖譜 + OA 連結
 *   5. PMC 全文閱讀 — 開放取用文章的完整 XML 全文
 *   6. Unpaywall — 查 DOI 對應的合法 OA 全文連結
 *   7. DailyMed (NIH/NLM) — FDA 藥品仿單（適應症、劑量、副作用、禁忌）
 *   8. OpenFDA — FDA 藥品標籤 + 不良反應報告 (FAERS)
 *   9. RxNorm (NIH/NLM) — 藥品名稱標準化 + 藥品交互作用
 *
 * 所有端點均不需要 API 金鑰。
 * PubMed 無 key 限制 3 req/sec，Semantic Scholar 限制 100 req/5min（共用）。
 */

const USER_AGENT = 'SmartMCP/2.0 (medical-search)';
const DEFAULT_TIMEOUT = 25000;
const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// ---------------------------------------------------------------------------
// 工具函式
// ---------------------------------------------------------------------------

function extractYear(pubdate) {
  const m = String(pubdate).match(/(\d{4})/);
  return m ? m[1] : '';
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 800);
}

function deduplicateByDOI(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (!a.doi) return true;
    const key = a.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDateFilter(dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(`${dateFrom}[dp]`);
  if (dateTo) parts.push(`${dateTo}[dp]`);
  return parts.length > 0 ? ` AND ${parts.join(':')}` : '';
}

// ---------------------------------------------------------------------------
// 1. OpenEvidence 公開端點（免金鑰，IP rate-limited）
// ---------------------------------------------------------------------------

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
    body: JSON.stringify({ question, max_citations: 10, stream: false }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      return { ok: false, error: 'rate_limited', message: `OpenEvidence 免費額度已用完（HTTP ${res.status}），自動降級` };
    }
    throw new Error(`OpenEvidence API ${res.status}`);
  }
  return { ok: true, data: await res.json() };
}

function formatOpenEvidenceResult(data) {
  const lines = ['=== 🏥 OpenEvidence 臨床證據查詢結果 ===', ''];

  const answer = data.answer || data.text || '';
  if (answer) { lines.push('📋 答案：', answer, ''); }

  if (data.confidence !== undefined) {
    const pct = (data.confidence * 100).toFixed(0);
    const level = data.confidence > 0.7 ? '🟢 高' : data.confidence > 0.4 ? '🟡 中' : '🔴 低';
    lines.push(`📊 信心水準：${pct}%（${level}）`);
  }

  const citations = data.citations || [];
  if (citations.length > 0) {
    lines.push('', `📚 引用文獻（${citations.length} 篇）：`);
    citations.forEach((c, i) => {
      lines.push(`  [${i + 1}] ${c.title || '(無標題)'}`);
      if (c.source || c.journal) lines.push(`      來源：${c.source || c.journal}${c.year ? ` (${c.year})` : ''}`);
      if (c.authors?.length) lines.push(`      作者：${c.authors.slice(0, 3).join(', ')}${c.authors.length > 3 ? ' 等' : ''}`);
      if (c.doi || c.url) lines.push(`      🔗 ${c.doi || c.url}`);
      if (c.evidence_level) lines.push(`      證據等級：${c.evidence_level}`);
      lines.push('');
    });
  }

  const disclaimers = data.disclaimers || [];
  if (disclaimers.length > 0) {
    lines.push('⚠️ 免責聲明：');
    disclaimers.forEach(d => lines.push(`  - ${d}`));
  }

  lines.push('', '📌 資料來源：OpenEvidence（免費公開端點，IP rate-limited）');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. PubMed API — ESearch → EFetch（含 abstract + MeSH）+ ELink（PMC 全文連結）
// ---------------------------------------------------------------------------

async function searchPubMed(query, maxResults = 10, dateFrom, dateTo) {
  const dateFilter = buildDateFilter(dateFrom, dateTo);
  const fullQuery = `${query}${dateFilter}`;

  // Step 1: ESearch
  const searchUrl = `${PUBMED_BASE}/esearch.fcgi`
    + `?db=pubmed&term=${encodeURIComponent(fullQuery)}&retmax=${maxResults}&retmode=json&sort=relevance`;

  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!searchRes.ok) throw new Error(`PubMed search failed: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const idList = searchData?.esearchresult?.idlist || [];
  if (idList.length === 0) return [];

  // Step 2: EFetch — 拿 abstract + MeSH（XML 格式）
  const fetchUrl = `${PUBMED_BASE}/efetch.fcgi`
    + `?db=pubmed&id=${idList.join(',')}&retmode=xml&rettype=abstract`;

  const fetchRes = await fetch(fetchUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!fetchRes.ok) throw new Error(`PubMed fetch failed: ${fetchRes.status}`);

  const xmlText = await fetchRes.text();
  return parsePubMedXML(xmlText, idList);
}

function parsePubMedXML(xml, idList) {
  const articles = [];
  const articleBlocks = xml.split('<PubmedArticle>').slice(1);

  for (const block of articleBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    const getMulti = (tag) => {
      const results = [];
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
      let m;
      while ((m = re.exec(block)) !== null) {
        results.push(m[1].replace(/<[^>]+>/g, '').trim());
      }
      return results;
    };

    const pmid = get('PMID');
    const title = get('ArticleTitle');
    const abstract = get('AbstractText') || get('Abstract');
    const journal = get('Title') || get('ISOAbbreviation');
    const year = get('PubDate').match(/\d{4}/)?.[0] || '';
    const volume = get('Volume');
    const issue = get('Issue');
    const pages = get('MedlinePgn');
    const doi = get('ELocationID');
    const authors = getMulti('LastName').map((last, i) => {
      const first = getMulti('ForeName')[i] || '';
      return first ? `${first} ${last}` : last;
    }).filter(Boolean);

    // MeSH terms
    const meshTerms = getMulti('DescriptorName');

    // Article types (e.g., Review, Randomized Controlled Trial)
    const pubTypes = getMulti('PublicationType');

    articles.push({
      id: pmid,
      title: title || '(無標題)',
      authors,
      journal,
      year,
      doi,
      pmid,
      volume,
      issue,
      pages,
      abstract: abstract.slice(0, 1000),
      meshTerms,
      pubTypes,
      source: 'PubMed',
    });
  }

  // 如果 XML 解析失敗（格式異常），fallback 到 ESummary
  if (articles.length === 0) {
    return fallbackPubMedSummary(idList);
  }

  return articles;
}

async function fallbackPubMedSummary(idList) {
  const summaryUrl = `${PUBMED_BASE}/esummary.fcgi`
    + `?db=pubmed&id=${idList.join(',')}&retmode=json`;
  const res = await fetch(summaryUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) return [];

  const data = await res.json();
  const result = data?.result || {};
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
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.pages || '',
      meshTerms: [],
      pubTypes: [],
      source: 'PubMed',
    };
  }).filter(Boolean);
}

// ELink — 查 PMC 全文連結
async function fetchPMCLinks(pmidList) {
  if (pmidList.length === 0) return {};
  const url = `${PUBMED_BASE}/elink.fcgi`
    + `?dbfrom=pubmed&db=pmc&id=${pmidList.join(',')}&retmode=json`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) return {};

  const data = await res.json();
  const linkMap = {};
  const linksets = data?.linksets || [];

  for (const ls of linksets) {
    const fromId = ls?.idlist?.[0];
    if (!fromId) continue;
    for (const lsd of ls?.linksetdbs || []) {
      if (lsd?.dbto === 'pmc' && lsd?.links) {
        const pmcId = lsd.links[0];
        if (pmcId) linkMap[fromId] = `PMC${pmcId}`;
      }
    }
  }
  return linkMap;
}

// ---------------------------------------------------------------------------
// 3. OpenAlex API（免費，無需金鑰）
// ---------------------------------------------------------------------------

async function searchOpenAlex(query, maxResults = 10, dateFrom, dateTo) {
  let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${Math.min(maxResults, 50)}`;

  if (dateFrom || dateTo) {
    // OpenAlex 需要 YYYY-MM-DD 格式
    const fmt = (d) => {
      if (!d) return '';
      if (/^\d{4}$/.test(d)) return `${d}-01-01`;
      if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
      return d; // 假設已是 YYYY-MM-DD
    };
    const from = fmt(dateFrom);
    const to = fmt(dateTo);
    const filters = [];
    if (from) filters.push(`from_publication_date:${from}`);
    if (to) filters.push(`to_publication_date:${to}`);
    url += `&filter=${filters.join(',')}`;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`OpenAlex search failed: ${res.status}`);

  const data = await res.json();
  return (data?.results || []).map(item => {
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
      oaUrl: item.open_access?.oa_url || '',
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Semantic Scholar API（免費，100 req/5min 共用）
// ---------------------------------------------------------------------------

async function searchSemanticScholar(query, maxResults = 10) {
  const fields = 'title,authors,year,abstract,tldr,citationCount,openAccessPdf,externalIds,publicationTypes,publicationVenue';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search`
    + `?query=${encodeURIComponent(query)}&limit=${Math.min(maxResults, 20)}&fields=${fields}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (res.status === 429) {
    return { ok: false, error: 'rate_limited', message: 'Semantic Scholar 免費額度已滿（100 req/5min），請稍後再試' };
  }
  if (!res.ok) throw new Error(`Semantic Scholar API ${res.status}`);

  const data = await res.json();
  const results = data?.data || [];

  return {
    ok: true,
    data: results.map(p => ({
      id: p.paperId,
      title: p.title || '(無標題)',
      authors: (p.authors || []).map(a => a.name).filter(Boolean),
      year: p.year || '',
      abstract: (p.abstract || '').slice(0, 800),
      tldr: p.tldr?.text || '',
      citedByCount: p.citationCount || 0,
      doi: p.externalIds?.DOI || '',
      pmid: p.externalIds?.PubMed || '',
      pmcid: p.externalIds?.PubMedCentral || '',
      openAccessPdf: p.openAccessPdf?.url || '',
      venue: p.publicationVenue?.name || '',
      pubTypes: p.publicationTypes || [],
      source: 'Semantic Scholar',
    })),
  };
}

// ---------------------------------------------------------------------------
// 5. PMC 全文閱讀（XML 格式，僅限 OA 文章）
// ---------------------------------------------------------------------------

async function fetchPMCArticle(pmcId) {
  // 確保 PMC ID 格式正確
  const cleanId = pmcId.replace(/^PMC/i, '');
  const url = `${PUBMED_BASE}/efetch.fcgi?db=pmc&id=${cleanId}&retmode=xml`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000), // 全文較大，延長 timeout
  });
  if (!res.ok) throw new Error(`PMC fetch failed: ${res.status}`);

  const xml = await res.text();
  return parsePMCArticle(xml, cleanId);
}

function parsePMCArticle(xml, pmcId) {
  const lines = ['=== 📄 PMC 全文閱讀 ===', `PMC ID：PMC${pmcId}`, ''];

  // 標題
  const titleMatch = xml.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/);
  if (titleMatch) lines.push('📌 標題：', titleMatch[1].replace(/<[^>]+>/g, '').trim(), '');

  // 作者
  const authorBlocks = xml.split('<contrib contrib-type="author">').slice(1);
  if (authorBlocks.length > 0) {
    const authors = authorBlocks.map(b => {
      const surname = b.match(/<surname>([^<]+)<\/surname>/)?.[1] || '';
      const given = b.match(/<given-names>([^<]+)<\/given-names>/)?.[1] || '';
      return given ? `${given} ${surname}` : surname;
    }).filter(Boolean);
    if (authors.length > 0) lines.push('👥 作者：', authors.join(', '), '');
  }

  // 摘要
  const abstractMatch = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/);
  if (abstractMatch) {
    lines.push('📋 摘要：');
    lines.push(abstractMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 2000));
    lines.push('');
  }

  // 文章段落（body sections）
  const bodyMatch = xml.match(/<body>([\s\S]*?)<\/body>/);
  if (bodyMatch) {
    lines.push('📖 內文：');
    lines.push('');

    // 提取 sections
    const sectionBlocks = bodyMatch[1].split('<sec>').slice(1);
    for (const sec of sectionBlocks) {
      const secTitle = sec.match(/<title[^>]*>([^<]+)<\/title>/)?.[1] || '';
      if (secTitle) lines.push(`### ${secTitle}`);

      // 提取段落
      const paragraphs = sec.match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
      for (const p of paragraphs) {
        const text = p.replace(/<[^>]+>/g, '').trim();
        if (text) lines.push(text, '');
      }
    }

    // 如果沒有 section 結構，直接提取所有 p
    if (sectionBlocks.length === 0) {
      const allP = bodyMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
      for (const p of allP) {
        const text = p.replace(/<[^>]+>/g, '').trim();
        if (text) lines.push(text, '');
      }
    }
  }

  // 參考文獻（前 20 筆）
  const refBlocks = xml.split('<ref ').slice(1);
  if (refBlocks.length > 0) {
    lines.push('📚 參考文獻（前 20 筆）：');
    refBlocks.slice(0, 20).forEach((r, i) => {
      const text = r.replace(/<[^>]+>/g, '').trim().slice(0, 200);
      lines.push(`  [${i + 1}] ${text}`);
    });
    lines.push('');
  }

  lines.push('📌 資料來源：PubMed Central（免費全文）');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 6. Unpaywall — 查 DOI 對應的 OA 全文連結（免費，需 email）
// ---------------------------------------------------------------------------

async function checkUnpaywall(doi) {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim();
  // Unpaywall 要求真實 email 格式（不可用 example.com）
  const email = 'research@smartmcp.dev';
  const url = `https://api.unpaywall.org/v2/${cleanDoi}?email=${email}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 404) return { ok: false, message: 'DOI 未找到' };
  if (res.status === 422) return { ok: false, message: `DOI 格式無效或 Unpaywall 無法處理：${cleanDoi}` };
  if (!res.ok) throw new Error(`Unpaywall API ${res.status}`);

  const data = await res.json();
  const bestOa = data?.best_oa_location;

  return {
    ok: true,
    data: {
      isOa: data.is_oa || false,
      bestUrl: bestOa?.url_for_pdf || bestOa?.url || '',
      version: bestOa?.version || '',
      license: bestOa?.license || '',
      hostType: bestOa?.host_type || '',
      allOaLocations: (data.oa_locations || []).map(loc => ({
        url: loc.url_for_pdf || loc.url || '',
        version: loc.version || '',
        license: loc.license || '',
        hostType: loc.host_type || '',
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 7. DailyMed — FDA 藥品仿單（免費，NIH/NLM 端點）
// ---------------------------------------------------------------------------

async function searchDailyMed(drugName) {
  const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/drugnames.json?drug_name=${encodeURIComponent(drugName)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`DailyMed API ${res.status}`);
  const data = await res.json();
  return data?.data?.drugnames || [];
}

async function fetchDailyMedSPL(setId) {
  const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setId}.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`DailyMed SPL fetch failed: ${res.status}`);
  return await res.json();
}

function extractSection(spl, sectionCode) {
  if (!spl?.data?.sections) return '';
  for (const sec of spl.data.sections) {
    if (sec.section_code === sectionCode) {
      return (sec.text || '').replace(/<[^>]+>/g, '').trim().slice(0, 2000);
    }
  }
  return '';
}

function formatDailyMedResult(drugName, drugList, splData) {
  const lines = [`=== 💊 DailyMed 藥品仿單查詢 ===`, `查詢藥品：${drugName}`, ''];

  if (splData) {
    const title = splData.data?.title || '';
    if (title) lines.push(`📌 藥品名稱：${title}`, '');

    // 適應症
    const indications = extractSection(splData, '34000-2');
    if (indications) lines.push('🎯 適應症：', indications, '');

    // 用法用量
    const usage = extractSection(splData, '34001-6');
    if (usage) lines.push('💊 用法用量：', usage, '');

    // 禁忌
    const contraindications = extractSection(splData, '34002-0');
    if (contraindications) lines.push('🚫 禁忌：', contraindications, '');

    // 警告與注意事項
    const warnings = extractSection(splData, '34003-8');
    if (warnings) lines.push('⚠️ 警告與注意事項：', warnings.slice(0, 1500), '');

    // 副作用
    const adverseReactions = extractSection(splData, '34004-6');
    if (adverseReactions) lines.push('🤢 副作用：', adverseReactions.slice(0, 1500), '');

    // 藥物交互作用
    const interactions = extractSection(splData, '34005-3');
    if (interactions) lines.push('💊 藥物交互作用：', interactions.slice(0, 1500), '');

    // 藥理學
    const pharmacology = extractSection(splData, '34010-3');
    if (pharmacology) lines.push('🔬 藥理學/作用機轉：', pharmacology.slice(0, 1000), '');

    // 藥代動力學
    const pk = extractSection(splData, '34011-1');
    if (pk) lines.push('📊 藥代動力學：', pk.slice(0, 1000), '');
  }

  // 如果沒有 SPL 資料，顯示搜尋結果
  if (!splData && drugList.length > 0) {
    lines.push('📋 找到以下藥品（傳入 set_id 可取得完整仿單）：', '');
    drugList.slice(0, 10).forEach((d, i) => {
      lines.push(`  [${i + 1}] ${d.name}`);
      if (d.setid) lines.push(`      SetID：${d.setid}`);
      if (d.tenant) lines.push(`      製造商：${d.tenant}`);
      lines.push('');
    });
  }

  lines.push('📌 資料來源：DailyMed / NIH/NLM（FDA 官方仿單）');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 8. OpenFDA — 藥品標籤 + 不良反應報告（免費，FDA 官方）
// ---------------------------------------------------------------------------

async function searchOpenFDALabels(drugName, maxResults = 5) {
  const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drugName)}+openfda.generic_name:${encodeURIComponent(drugName)}&limit=${maxResults}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (res.status === 404) return []; // 無結果不算錯
  if (!res.ok) throw new Error(`OpenFDA label API ${res.status}`);
  const data = await res.json();
  return data?.results || [];
}

async function searchOpenFDAEvents(drugName, maxResults = 5) {
  const url = `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.brand_name:${encodeURIComponent(drugName)}+patient.drug.openfda.generic_name:${encodeURIComponent(drugName)}&limit=${maxResults}&sort=date:desc`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`OpenFDA event API ${res.status}`);
  const data = await res.json();
  return data?.results || [];
}

function formatOpenFDAResult(drugName, labels, events) {
  const lines = [`=== 🏥 OpenFDA 藥品資訊查詢 ===`, `查詢藥品：${drugName}`, ''];

  if (labels.length > 0) {
    lines.push('📋 藥品標籤（FDA Label）：', '');
    labels.forEach((label, i) => {
      const brand = label.openfda?.brand_name?.[0] || '';
      const generic = label.openfda?.generic_name?.[0] || '';
      const manufacturer = label.openfda?.manufacturer_name?.[0] || '';
      if (brand || generic) lines.push(`  [${i + 1}] ${brand} (${generic})`);
      if (manufacturer) lines.push(`      製造商：${manufacturer}`);

      // 摘要化各欄位
      for (const [field, emoji] of [
        ['indications_and_usage', '🎯 適應症'],
        ['dosage_and_administration', '💊 劑量'],
        ['contraindications', '🚫 禁忌'],
        ['warnings', '⚠️ 警告'],
        ['adverse_reactions', '🤢 副作用'],
        ['drug_interactions', '💊 藥物交互作用'],
        ['clinical_pharmacology', '🔬 臨床藥理學'],
      ]) {
        const val = label[field];
        if (val) {
          const text = Array.isArray(val) ? val.join(' ') : String(val);
          lines.push(`      ${emoji}：${text.replace(/<[^>]+>/g, '').trim().slice(0, 500)}`);
        }
      }
      lines.push('');
    });
  }

  if (events.length > 0) {
    lines.push('📋 不良反應報告（FAERS）：', '');
    // 統計反應
    const reactions = {};
    events.forEach(e => {
      for (const r of (e.patient?.reaction || [])) {
        const name = r.reactionmeddrapt || '';
        reactions[name] = (reactions[name] || 0) + 1;
      }
    });
    const sorted = Object.entries(reactions).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (sorted.length > 0) {
      lines.push('  常見不良反應統計：');
      sorted.forEach(([name, count]) => {
        lines.push(`    • ${name}：${count} 例`);
      });
    }
  }

  if (labels.length === 0 && events.length === 0) {
    lines.push('⚠️ OpenFDA 未找到此藥品的資料，請嘗試其他名稱（品牌名/學名）');
  }

  lines.push('', '📌 資料來源：OpenFDA / FDA 官方');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 9. RxNorm — 藥品名稱標準化 + 藥品交互作用（免費，NIH/NLM 端點）
// ---------------------------------------------------------------------------

async function searchRxNorm(drugName) {
  const url = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(drugName)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`RxNorm API ${res.status}`);
  const data = await res.json();
  return data?.drugGroup?.conceptGroup || [];
}

async function fetchRxNormProperties(rxcui) {
  const url = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/properties.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.properties || null;
}

async function fetchDrugInteractions(rxcui) {
  const url = `https://rxnav.nlm.nih.gov/REST/interaction/interaction.json?rxcui=${rxcui}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const interactions = data?.interactionTypeGroup?.[0]?.interactionType || [];
  const results = [];
  for (const it of interactions) {
    for (const pair of (it.interactionPair || [])) {
      results.push({
        severity: it.severity || 'unknown',
        description: pair.description || '',
        drug1: pair.interactionConcept?.[0]?.minConceptItem?.name || '',
        drug2: pair.interactionConcept?.[1]?.minConceptItem?.name || '',
      });
    }
  }
  return results;
}

function formatRxNormResult(drugName, conceptGroups) {
  const lines = [`=== 💊 RxNorm 藥品名稱查詢 ===`, `查詢藥品：${drugName}`, ''];

  let foundAny = false;
  for (const group of conceptGroups) {
    const concepts = group.conceptProperties || [];
    if (concepts.length === 0) continue;
    foundAny = true;

    const tty = group.tty || '';
    const ttyLabel = {
      'IN': '🔬 學名 (Ingredient)',
      'PIN': '🔬 生藥學名 (Precise Ingredient)',
      'BN': '💊 品牌名 (Brand Name)',
      'SBD': '💊 成分+劑型+品牌 (Semantic Branded Drug)',
      'SCD': '💊 成分+劑型+通用名 (Semantic Clinical Drug)',
      'GPCK': '📦 成分+劑型+品牌組合',
      'DF': '💉 劑型 (Dose Form)',
      'SYN': '🔗 別名 (Synonym)',
    };
    lines.push(ttyLabel[tty] || `📌 ${tty}：`);
    concepts.slice(0, 5).forEach((c, i) => {
      lines.push(`  [${i + 1}] ${c.name} (RxCUI: ${c.rxcui})`);
    });
    lines.push('');
  }

  if (!foundAny) {
    lines.push('⚠️ RxNorm 未找到此藥品名稱');
  }

  lines.push('📌 資料來源：RxNorm / NIH/NLM（藥品名稱標準化）');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');
  return lines.join('\n');
}

function formatDrugInteractions(drugName, interactions) {
  const lines = [`=== 💥 藥品交互作用查詢 ===`, `查詢藥品：${drugName}`, ''];

  if (interactions.length === 0) {
    lines.push('✅ RxNorm 未記錄此藥品的已知交互作用');
    lines.push('（不代表無交互作用，請仍諮詢藥師或醫師）');
  } else {
    lines.push(`⚠️ 找到 ${interactions.length} 筆交互作用：`, '');
    const severityEmoji = { 'major': '🔴 嚴重', 'moderate': '🟡 中等', 'minor': '🟢 輕微', 'unknown': '⚪ 未知' };
    interactions.forEach((inter, i) => {
      const sev = severityEmoji[inter.severity] || inter.severity;
      lines.push(`  [${i + 1}] ${inter.drug1} ↔ ${inter.drug2}`);
      lines.push(`      嚴重度：${sev}`);
      if (inter.description) lines.push(`      說明：${inter.description}`);
      lines.push('');
    });
  }

  lines.push('📌 資料來源：RxNorm Interaction API / NIH/NLM');
  lines.push('⚠️ 本工具僅供參考，不構成醫療建議。實際交互作用請諮詢藥師或醫師。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 格式化輸出
// ---------------------------------------------------------------------------

function formatPubMedResults(articles) {
  if (articles.length === 0) return '⚠️ PubMed 未找到相關文獻。';
  const lines = ['=== 📚 PubMed 醫學文獻查詢結果 ===', ''];
  articles.forEach((a, i) => {
    lines.push(`  [${i + 1}] ${a.title}`);
    if (a.authors?.length) lines.push(`      作者：${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 等' : ''}`);
    const journalInfo = [a.journal, a.year, a.volume, a.pages].filter(Boolean).join(', ');
    if (journalInfo) lines.push(`      期刊：${journalInfo}`);
    if (a.doi) lines.push(`      DOI：${a.doi}`);
    lines.push(`      PMID：${a.id}`);
    lines.push(`      🔗 https://pubmed.ncbi.nlm.nih.gov/${a.id}/`);
    if (a.abstract) lines.push(`      摘要：${a.abstract.slice(0, 200)}${a.abstract.length > 200 ? '...' : ''}`);
    if (a.meshTerms?.length) lines.push(`      MeSH：${a.meshTerms.slice(0, 5).join(', ')}`);
    if (a.pubTypes?.length) lines.push(`      類型：${a.pubTypes.join(', ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatOpenAlexResults(articles) {
  if (articles.length === 0) return '⚠️ OpenAlex 未找到相關文獻。';
  const lines = ['=== 📚 OpenAlex 學術文獻查詢結果 ===', ''];
  articles.forEach((a, i) => {
    lines.push(`  [${i + 1}] ${a.title}`);
    if (a.authors?.length) lines.push(`      作者：${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 等' : ''}`);
    if (a.journal) lines.push(`      期刊：${a.journal} (${a.year})`);
    if (a.doi) lines.push(`      DOI：${a.doi}`);
    if (a.citedByCount) lines.push(`      被引用次數：${a.citedByCount}`);
    if (a.openAccess) lines.push(`      ${a.openAccess}`);
    if (a.oaUrl) lines.push(`      🔓 OA 連結：${a.oaUrl}`);
    if (a.abstract) lines.push(`      摘要：${a.abstract.slice(0, 300)}${a.abstract.length > 300 ? '...' : ''}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatSemanticScholarResults(data) {
  if (!data || data.length === 0) return '⚠️ Semantic Scholar 未找到相關文獻。';
  const lines = ['=== 📚 Semantic Scholar 查詢結果 ===', ''];
  data.forEach((a, i) => {
    lines.push(`  [${i + 1}] ${a.title}`);
    if (a.authors?.length) lines.push(`      作者：${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 等' : ''}`);
    if (a.venue) lines.push(`      會議/期刊：${a.venue} (${a.year})`);
    else if (a.year) lines.push(`      年份：${a.year}`);
    if (a.doi) lines.push(`      DOI：${a.doi}`);
    if (a.pmid) lines.push(`      PMID：${a.pmid}`);
    if (a.citedByCount) lines.push(`      被引用次數：${a.citedByCount}`);
    if (a.tldr) lines.push(`      🤖 TLDR：${a.tldr}`);
    if (a.abstract && !a.tldr) lines.push(`      摘要：${a.abstract.slice(0, 300)}${a.abstract.length > 300 ? '...' : ''}`);
    if (a.openAccessPdf) lines.push(`      📄 PDF：${a.openAccessPdf}`);
    if (a.pubTypes?.length) lines.push(`      類型：${a.pubTypes.join(', ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatMergedResults(pubmed, openalex, scholar, query) {
  const parts = [`🔍 綜合醫學查詢：「${query}」`, ''];

  if (pubmed.length > 0) {
    parts.push(formatPubMedResults(pubmed), '');
  }
  if (openalex.length > 0) {
    parts.push(formatOpenAlexResults(openalex), '');
  }
  if (scholar?.data?.length > 0) {
    parts.push(formatSemanticScholarResults(scholar.data), '');
  }

  // 統計
  const totalRaw = pubmed.length + openalex.length + (scholar?.data?.length || 0);
  parts.push(`📊 統計：PubMed ${pubmed.length} 筆、OpenAlex ${openalex.length} 筆、Semantic Scholar ${scholar?.data?.length || 0} 筆`);
  parts.push('', '📌 資料來源：PubMed、OpenAlex、Semantic Scholar（全免費）');
  parts.push('⚠️ 本工具僅供參考，不構成醫療建議。請諮詢專業醫療人員。');

  return parts.join('\n');
}

function formatOACheckResult(doi, result) {
  if (!result.ok) return `⚠️ 無法查詢 OA 狀態：${result.message}`;

  const d = result.data;
  const lines = [`=== 🔓 OA 全文連結查詢 ===`, `DOI：${doi}`, ''];

  if (d.isOa) {
    lines.push('✅ 此文獻有開放取用版本');
    if (d.bestUrl) lines.push(`🔗 最佳連結：${d.bestUrl}`);
    if (d.version) lines.push(`📌 版本：${d.version}`);
    if (d.license) lines.push(`📜 授權：${d.license}`);
    if (d.hostType) lines.push(`🏠 來源類型：${d.hostType}`);
    if (d.allOaLocations?.length > 1) {
      lines.push('');
      lines.push(`📋 所有 OA 來源（${d.allOaLocations.length} 個）：`);
      d.allOaLocations.forEach((loc, i) => {
        lines.push(`  [${i + 1}] ${loc.url}`);
        lines.push(`      版本：${loc.version || '未知'} | 授權：${loc.license || '未知'} | 類型：${loc.hostType || '未知'}`);
      });
    }
  } else {
    lines.push('❌ 此文獻無開放取用版本');
    lines.push('💡 建議：嘗試透過學校/機構圖書館存取，或聯繫作者索取');
  }

  lines.push('', '📌 資料來源：Unpaywall（免費 OA 偵測）');
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
  const maxResults = args.maxResults || 10;
  const dateFrom = args.dateFrom || '';
  const dateTo = args.dateTo || '';

  if (!searchQuery && action !== 'fulltext' && action !== 'pmc' && action !== 'oa-check') {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    switch (action) {

      // ── 自動模式：先試 OpenEvidence，失敗降級到 PubMed ──
      case 'auto':
      case 'ask': {
        const oeResult = await searchOpenEvidence(searchQuery).catch(err => ({
          ok: false, error: 'failed', message: err.message,
        }));

        if (oeResult.ok) {
          return { ok: true, output: formatOpenEvidenceResult(oeResult.data) };
        }

        const articles = await searchPubMed(searchQuery, maxResults, dateFrom, dateTo);
        let output = `⚠️ OpenEvidence：${oeResult.message || '無法連線'}\n\n`;
        output += '⬇️ 自動降級到 PubMed 文獻搜尋：\n\n';
        output += formatPubMedResults(articles);
        return { ok: true, output };
      }

      // ── OpenEvidence 專用 ──
      case 'oe':
      case 'openevidence': {
        const oeResult = await searchOpenEvidence(searchQuery).catch(err => ({
          ok: false, error: 'failed', message: err.message,
        }));
        if (!oeResult.ok) {
          const articles = await searchPubMed(searchQuery, maxResults, dateFrom, dateTo).catch(() => []);
          let output = `⚠️ OpenEvidence：${oeResult.message || '無法連線'}\n\n`;
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
        const articles = await searchPubMed(searchQuery, maxResults, dateFrom, dateTo);
        // 查 PMC 全文連結
        const pmids = articles.map(a => a.id).filter(Boolean);
        const pmcLinks = await fetchPMCLinks(pmids).catch(() => ({}));
        // 附加 PMC 連結到結果
        for (const a of articles) {
          if (pmcLinks[a.id]) a.pmcFullText = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcLinks[a.id]}/`;
        }
        let output = formatPubMedResults(articles);
        // 顯示有全文的文章
        const withFullText = articles.filter(a => a.pmcFullText);
        if (withFullText.length > 0) {
          output += `\n📄 有 PMC 全文的文章：\n`;
          withFullText.forEach(a => {
            output += `  • ${a.title.slice(0, 60)}... → ${a.pmcFullText}\n`;
          });
        }
        return { ok: true, output };
      }

      // ── OpenAlex 學術搜尋 ──
      case 'openalex':
      case 'academic': {
        const articles = await searchOpenAlex(searchQuery, maxResults, dateFrom, dateTo);
        return { ok: true, output: formatOpenAlexResults(articles) };
      }

      // ── Semantic Scholar 搜尋 ──
      case 'scholar':
      case 'semantic': {
        const result = await searchSemanticScholar(searchQuery, maxResults);
        if (!result.ok) return { ok: true, output: `⚠️ ${result.message}` };
        return { ok: true, output: formatSemanticScholarResults(result.data) };
      }

      // ── PMC 全文閱讀 ──
      case 'fulltext':
      case 'pmc': {
        const pmcId = searchQuery || args.pmcId || '';
        if (!pmcId) return { ok: false, error: '需要提供 PMC ID（例如：PMC123456）' };
        const article = await fetchPMCArticle(pmcId);
        return { ok: true, output: article };
      }

      // ── PubMed Abstract 閱讀 ──
      case 'abstract': {
        const pmid = searchQuery || args.pmid || '';
        if (!pmid) return { ok: false, error: '需要提供 PMID' };
        const articles = await searchPubMed(pmid, 1, dateFrom, dateTo);
        if (articles.length === 0) return { ok: true, output: '⚠️ 未找到該 PMID 的文獻' };
        const a = articles[0];
        const lines = [`=== 📋 PubMed Abstract ===`, ''];
        lines.push(`📌 ${a.title}`, '');
        if (a.authors?.length) lines.push(`👥 作者：${a.authors.join(', ')}`, '');
        if (a.journal) lines.push(`📰 期刊：${a.journal} (${a.year})`, '');
        if (a.abstract) {
          lines.push('📋 摘要：', a.abstract, '');
        } else {
          lines.push('⚠️ 此文獻無摘要', '');
        }
        if (a.meshTerms?.length) lines.push(`🏷️ MeSH：${a.meshTerms.join(', ')}`, '');
        if (a.pubTypes?.length) lines.push(`📂 類型：${a.pubTypes.join(', ')}`, '');
        lines.push(`🔗 https://pubmed.ncbi.nlm.nih.gov/${a.id}/`);
        return { ok: true, output: lines.join('\n') };
      }

      // ── OA 全文連結查詢 ──
      case 'oa-check':
      case 'oa': {
        const doi = searchQuery || args.doi || '';
        if (!doi) return { ok: false, error: '需要提供 DOI' };
        const result = await checkUnpaywall(doi);
        return { ok: true, output: formatOACheckResult(doi, result) };
      }

      // ── DailyMed 藥品仿單查詢 ──
      case 'drug':
      case 'dailymed': {
        if (!searchQuery) return { ok: false, error: '需要提供藥品名稱（question 或 query）' };
        const drugList = await searchDailyMed(searchQuery).catch(() => []);
        if (drugList.length === 0) {
          return { ok: true, output: `⚠️ DailyMed 未找到「${searchQuery}」的藥品資料\n💡 建議：嘗試使用學名或品牌名稱` };
        }
        // 嘗試取得第一個藥品的完整仿單
        let splData = null;
        const firstSetId = drugList[0]?.setid;
        if (firstSetId) {
          splData = await fetchDailyMedSPL(firstSetId).catch(() => null);
        }
        return { ok: true, output: formatDailyMedResult(searchQuery, drugList, splData) };
      }

      // ── OpenFDA 藥品標籤 + 不良反應 ──
      case 'fda':
      case 'openfda': {
        if (!searchQuery) return { ok: false, error: '需要提供藥品名稱（question 或 query）' };
        const [labels, events] = await Promise.all([
          searchOpenFDALabels(searchQuery, Math.min(maxResults, 5)).catch(() => []),
          searchOpenFDAEvents(searchQuery, Math.min(maxResults, 10)).catch(() => []),
        ]);
        return { ok: true, output: formatOpenFDAResult(searchQuery, labels, events) };
      }

      // ── RxNorm 藥品名稱 + 交互作用 ──
      case 'interact':
      case 'rxnorm': {
        if (!searchQuery) return { ok: false, error: '需要提供藥品名稱（question 或 query）' };
        const groups = await searchRxNorm(searchQuery).catch(() => []);
        // 取得第一個 IN (ingredient) 的 RxCUI 查交互作用
        let rxcui = '';
        for (const g of groups) {
          if (g.tty === 'IN' && g.conceptProperties?.[0]) {
            rxcui = g.conceptProperties[0].rxcui;
            break;
          }
        }
        let interactions = [];
        if (rxcui) {
          interactions = await fetchDrugInteractions(rxcui).catch(() => []);
        }
        // 組合輸出：先顯示名稱查詢結果，再顯示交互作用
        let output = formatRxNormResult(searchQuery, groups);
        if (rxcui) {
          output += '\n' + formatDrugInteractions(searchQuery, interactions);
        }
        return { ok: true, output };
      }

      // ── 綜合查詢（去重 + 多來源） ──
      case 'all':
      case 'comprehensive': {
        const perSource = Math.min(maxResults, 8);
        const [pubmed, openalex, scholar] = await Promise.all([
          searchPubMed(searchQuery, perSource, dateFrom, dateTo).catch(() => []),
          searchOpenAlex(searchQuery, perSource, dateFrom, dateTo).catch(() => []),
          searchSemanticScholar(searchQuery, perSource).catch(() => ({ ok: false, data: [] })),
        ]);

        // 跨來源去重
        const allArticles = [...pubmed, ...openalex, ...(scholar?.data || [])];
        const deduped = deduplicateByDOI(allArticles);
        const removedCount = allArticles.length - deduped.length;

        let output = formatMergedResults(pubmed, openalex, scholar, searchQuery);
        if (removedCount > 0) {
          output += `\n🔄 去重：移除 ${removedCount} 筆重複文章（DOI 比對）`;
        }

        return { ok: true, output };
      }

      default:
        return {
          ok: false,
          error: `未知的 action：${action}。`
            + `支援：auto/ask, oe/openevidence, search/pubmed, openalex/academic, `
            + `scholar/semantic, fulltext/pmc, abstract, oa-check/oa, all/comprehensive, `
              + `drug/dailymed, fda/openfda, interact/rxnorm`,
        };
    }
  } catch (err) {
    return { ok: false, error: `醫學查詢失敗：${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// 匯出
// ---------------------------------------------------------------------------

export default {
  name: 'smart_medical_search',
  category: 'core',
  description: '免費醫學文獻與臨床證據查詢（增強版 v2）。完全免費，不需要任何 API 金鑰。\n\n'
    + '支援 6 大資料來源：\n'
    + '  • OpenEvidence — 臨床證據問答，IP rate-limited\n'
    + '  • PubMed — 3700 萬+ 醫學文獻，含 abstract + MeSH terms\n'
    + '  • OpenAlex — 2.5 億+ 學術作品，含引用數據 + abstract\n'
    + '  • Semantic Scholar — 2 億+ 論文，TLDR 摘要 + 引用圖譜 + OA 連結\n'
    + '  • PMC 全文閱讀 — 開放取用文章的完整全文（XML 格式）\n'
    + '  • Unpaywall — 查 DOI 對應的合法 OA 全文連結\n\n'
    + '支援動作：\n'
    + '  action=auto/ask：自動模式（預設，先試 OpenEvidence 再降級）\n'
    + '  action=oe/openevidence：強制 OpenEvidence\n'
    + '  action=search/pubmed：PubMed 文獻搜尋（含 abstract + MeSH + PMC 全文連結）\n'
    + '  action=openalex/academic：OpenAlex 學術搜尋\n'
    + '  action=scholar/semantic：Semantic Scholar 搜尋（含 TLDR）\n'
    + '  action=fulltext/pmc：PMC 全文閱讀（需提供 PMC ID）\n'
    + '  action=abstract：PubMed abstract 閱讀（需提供 PMID）\n'
    + '  action=oa-check/oa：OA 全文連結查詢（需提供 DOI）\n'
    + '  action=all/comprehensive：綜合查詢（多來源 + 跨來源去重）\n'
    + '  action=drug/dailymed：DailyMed 藥品仿單查詢（適應症、劑量、副作用、禁忌）\n'
    + '  action=fda/openfda：OpenFDA 藥品標籤 + 不良反應報告（FAERS）\n'
    + '  action=interact/rxnorm：RxNorm 藥品名稱 + 藥品交互作用查詢\n\n'
    + '支援日期範圍過濾（dateFrom/dateTo，格式：YYYY 或 YYYY/MM/DD）。\n'
    + '完全免費，無需註冊或 API 金鑰。',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'auto', 'ask', 'oe', 'openevidence',
          'search', 'pubmed', 'openalex', 'academic',
          'scholar', 'semantic', 'fulltext', 'pmc',
          'abstract', 'oa-check', 'oa',
          'all', 'comprehensive',
          'drug', 'dailymed', 'fda', 'openfda',
          'interact', 'rxnorm',
        ],
        description: '查詢動作。auto=自動，search=PubMed，openalex=OpenAlex，scholar=Semantic Scholar，fulltext=PMC全文，abstract=PubMed摘要，oa-check=OA連結查詢，all=綜合，drug/dailymed=DailyMed仿單，fda/openfda=OpenFDA標籤，interact/rxnorm=RxNorm交互作用',
      },
      question: {
        type: 'string',
        description: '醫學問題或關鍵字（例如："What is the recommended treatment for acute migraine?"）',
      },
      query: {
        type: 'string',
        description: '查詢字串（question 的別名，兩者擇一提供）',
      },
      maxResults: {
        type: 'number',
        description: '最大結果數量（預設 10）',
      },
      dateFrom: {
        type: 'string',
        description: '起始日期（格式：YYYY 或 YYYY/MM/DD），僅 PubMed 和 OpenAlex 支援',
      },
      dateTo: {
        type: 'string',
        description: '結束日期（格式：YYYY 或 YYYY/MM/DD），僅 PubMed 和 OpenAlex 支援',
      },
      pmid: {
        type: 'string',
        description: 'PubMed PMID（action=abstract 時使用）',
      },
      pmcId: {
        type: 'string',
        description: 'PubMed Central PMC ID（action=fulltext/pmc 時使用，例如：PMC123456）',
      },
      doi: {
        type: 'string',
        description: 'DOI（action=oa-check 時使用）',
      },
    },
  },
  handler: medicalSearch,
};
