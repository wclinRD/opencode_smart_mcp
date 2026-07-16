// ── 多源搜尋統一入口 ────────────────────────────────────────────────────
export { httpsGet, GITHUB_API, OPENALEX_API, SCHOLAR_API, USER_AGENT, DEFAULT_TIMEOUT } from './http.mjs';
export { searchGitHubPDK, searchGitHubEDA, searchGitHubCode, formatGitHubResults } from './github.mjs';
export { searchWebDDG, formatWebResults } from './web.mjs';
export { searchEDACommunities, crawlForumPages, formatCommunityResults } from './community.mjs';
export { searchOpenAlex, reconstructAbstract, formatOpenAlexResults } from './openalex.mjs';
export { searchSemanticScholar, formatSemanticScholarResults } from './semantic-scholar.mjs';
