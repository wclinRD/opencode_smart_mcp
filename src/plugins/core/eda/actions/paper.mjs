/**
 * paper/papers — EDA 學術論文搜尋
 */
import { registerAction } from './registry.mjs';
import { enhanceQueryForEDA, detectConference } from '../query/enhance.mjs';
import { searchSemanticScholar, formatSemanticScholarResults } from '../sources/semantic-scholar.mjs';
import { searchOpenAlex, formatOpenAlexResults } from '../sources/openalex.mjs';
import { compressOutput } from '../lib/caveman.mjs';

registerAction('paper', async (args) => {
  const searchQuery = String(args.question || args.query || '').trim();
  const maxResults = args.maxResults || 10;
  let output = '';
  const enhancedQuery = enhanceQueryForEDA(searchQuery);

  // Semantic Scholar + TLDR
  try {
    const scholarResult = await searchSemanticScholar(enhancedQuery, maxResults);
    if (scholarResult.ok) {
      output += formatSemanticScholarResults(scholarResult.data) + '\n';
    } else {
      output += `⚠️ ${scholarResult.message}\n\n`;
    }
  } catch (err) {
    output += `⚠️ Semantic Scholar：${err.message}\n\n`;
  }

  // OpenAlex
  try {
    const articles = await searchOpenAlex(enhancedQuery, Math.min(maxResults, 5));
    output += formatOpenAlexResults(articles);
  } catch (err) {
    output += `⚠️ OpenAlex：${err.message}\n`;
  }

  // 偵測是否提到特定會議
  const conf = detectConference(searchQuery);
  if (conf) {
    output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
    output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
    output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
    output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
  }

  // Caveman 壓縮
  const compress = args.compress || 'none';
  console.log(`[EDA] compress=${compress}, output.length=${output.length}`);
  if (compress !== 'none') {
    const before = output.length;
    output = compressOutput(output, compress);
    console.log(`[EDA] compressed: ${before} → ${output.length} chars`);
  }

  return { ok: true, output: output || '📚 學術論文：無結果' };
}, ['papers']);
