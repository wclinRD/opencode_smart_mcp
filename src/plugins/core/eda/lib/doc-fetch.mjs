// ── 文件爬取 ─────────────────────────────────────────────────────────────
import { VENDOR_DOCS } from '../data/docs.mjs';
import { USER_AGENT } from '../sources/http.mjs';

export async function fetchDocContent(toolKey, topic) {
  const docInfo = VENDOR_DOCS[toolKey];
  if (!docInfo) return null;

  if (docInfo.type === 'open-source') {
    const doc = docInfo.docs.find(d => d.topic === topic) || docInfo.docs[0];
    if (!doc || !doc.url) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(doc.url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const content = await resp.text();
      const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n\n... (內容已截斷)' : content;
      return { tool: docInfo.name, topic: doc.topic, source: doc.url, type: 'fetched', content: truncated };
    } catch (err) {
      return { tool: docInfo.name, topic, source: doc.url, type: 'error', error: err.message };
    }
  }

  if (docInfo.type === 'commercial') {
    const docs = topic
      ? docInfo.docs.filter(d => d.topic === topic || d.topic === 'overview')
      : docInfo.docs.slice(0, 3);
    if (docs.length === 0) return null;
    return {
      tool: docInfo.name, topic: topic || 'overview', type: 'indexed', vendor: docInfo.vendor,
      excerpts: docs.map(d => ({ topic: d.topic, content: d.excerpt })),
      solvnet: docInfo.vendor === 'synopsys'
        ? `https://solvnet.synopsys.com/solve/qa?search=${encodeURIComponent(docInfo.name + ' ' + (topic || ''))}`
        : docInfo.vendor === 'cadence'
        ? `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution`
        : null,
    };
  }
  return null;
}
