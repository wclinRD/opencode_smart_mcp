// ── Registry + Actions（side-effect 自動註冊）────────────────────────────
import { dispatch } from './eda/actions/registry.mjs';
import './eda/actions/index.mjs';

// ── 多源搜尋（auto / all action 引用）────────────────────────────────────
import { multiSourceSearch, dedupResults, sortByRelevance } from './eda/sources/index.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// ── 主要處理函式（預驗證 + dispatch）────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ACTIONS_NO_QUERY = ['list-tools', 'list-pdk', 'list-conferences', 'flow', 'dft', 'lec', 'eco', 'fpga'];

async function edaSearch(args = {}) {
  const action = String(args.action || 'auto').toLowerCase();
  const searchQuery = String(args.question || args.query || '').trim();

  // 預驗證：部分 action 不需要 query
  if (!searchQuery && !ACTIONS_NO_QUERY.includes(action)) {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    return await dispatch(action, args);
  } catch (err) {
    return { ok: false, error: `EDA 搜尋錯誤: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin Export（向後相容：name/description/inputSchema/handler 不變）
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: 'smart_eda_search',
  description:
    '[search] EDA 領域智慧知識引擎。查詢 IC design、cell-based flow、EDA tool、PDK、學術論文。'
    + '完全免費，不需要 API 金鑰。'
    + '支援 18 種 action：auto（自動判斷）、pdk（PDK/cell library）、paper（學術論文）、tool（EDA 工具）、github（GitHub 專案）、code（程式碼搜尋）、all（綜合）、list-tools、list-pdk、list-conferences、flow、dft、lec、eco、fpga、troubleshoot（Tool 問題診斷含 FAQ+廠商 Q&A）。'
    + '資料來源：GitHub API + OpenAlex + Semantic Scholar + Exa（可選）。'
    + '內建 55+ EDA 工具索引（含 30+ 商業工具）、10+ PDK 索引、11 個 cell flow stages、10 個 tool FAQ 索引（DC/Innovus/PrimeTime/Calibre/Vivado/VCS/Xcelium/LEC/Formality）、9 大 EDA 會議。',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'auto', 'pdk', 'paper', 'papers',
          'tool', 'tools', 'github', 'code',
          'all', 'comprehensive',
          'list-tools', 'list-pdk', 'list-conferences',
          'flow', 'dft', 'lec', 'eco', 'fpga',
          'troubleshoot', 'docs',
        ],
        description: '查詢動作。auto=自動判斷類型，pdk=PDK/cell library，paper=學術論文，tool=EDA工具，github=GitHub專案，code=程式碼搜尋，all=綜合，list-tools=列出已知工具，list-pdk=列出已知PDK，list-conferences=列出EDA會議，flow=cell flow stages，dft=Design-for-Test，lec=Logic Equivalence Check，eco=Engineering Change Order，fpga=FPGA Design Flow，troubleshoot=Tool 問題診斷（FAQ+廠商Q&A），docs=爬取工具 user guide / 文件',
      },
      question: {
        type: 'string',
        description: 'EDA 相關問題或查詢（例如："SKY130 standard cell library 有哪些？"）',
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
  handler: edaSearch,
};
