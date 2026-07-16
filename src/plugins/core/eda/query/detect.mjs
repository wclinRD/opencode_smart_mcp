// ── 查詢偵測（topic / tool issue）───────────────────────────────────────
import { TOOL_ISSUE_PATTERNS } from '../data/meta.mjs';

export function detectDocTopic(query) {
  const q = query.toLowerCase();
  const topicMap = [
    ['overview', /overview|introduction|what is|介紹|概觀|概述/i],
    ['analyze', /analyze|analysis|分析/i],
    ['elaborate', /elaborate|展開/i],
    ['compile', /compile|synthesis|合成|編譯/i],
    ['link', /link|連結|連接/i],
    ['timing', /timing|時序|時脈|STA|setup|hold/i],
    ['area', /area|面積/i],
    ['power', /power|功耗|漏電/i],
    ['constraints', /constraint|SDC|constraint|set_clock|set_input|set_output/i],
    ['output', /output|write|write_sdc|write_sdf|輸出/i],
    ['placement', /place|placement|配置/i],
    ['cts', /cts|clock tree|時脈樹/i],
    ['route', /route|routing|繞線/i],
    ['opt', /opt|optimize|優化/i],
    ['drc', /DRC|design rule/i],
    ['lvs', /LVS|layout vs schematic/i],
    ['pex', /PEX|parasitic extraction|寄生/i],
    ['setup', /setup|initial|init|初始化/i],
    ['simulate', /simulate|simulation|模擬/i],
    ['debug', /debug|除錯|調試/i],
    ['coverage', /coverage|覆蓋率/i],
    ['lint', /lint|語法/i],
    ['cdc', /CDC|clock domain crossing/i],
    ['verify', /verify|verification| equivalence|等價/i],
    ['scan', /scan chain|scan insertion/i],
    ['ocv', /OCV|on-chip variation/i],
    ['clock', /clock|skew|latency/i],
    ['extraction', /extraction|提取/i],
  ];
  for (const [topic, pattern] of topicMap) {
    if (pattern.test(q)) return topic;
  }
  return null;
}

export function isToolIssueQuery(query) {
  return TOOL_ISSUE_PATTERNS.some(p => p.test(query));
}
