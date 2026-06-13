// mcts-planner.mjs — MCTS Tool Planning (Phase 17)
//
// 參考：ToolTree (ICLR 2026) — 雙回饋 MCTS + 雙向剪枝
// 核心：在工具空間中用蒙地卡羅樹搜尋最佳路徑，取代靜態正則匹配。
//
// 架構：
//   UCTNode → Selection (UCT) → Pre-Evaluation → Expansion → Simulation
//   → Post-Evaluation → Back-Propagation → Bidirectional Pruning → 收斂
//
// 使用場景：5+ 步驟的複雜 multi-step 任務，靜態匹配不確定時

// ---------------------------------------------------------------------------
// UCTNode — 蒙地卡羅樹節點
// ---------------------------------------------------------------------------
class UCTNode {
  constructor({ id, tool, args, parent = null, depth = 0 }) {
    this.id = id;
    this.tool = tool;
    this.args = args || {};
    this.parent = parent;
    this.children = [];
    this.depth = depth;

    this.visits = 0;
    this.reward = 0;
    this.preScore = 0;
    this.postScore = 0;
    this.pruned = false;
    this.pruneReason = null;
    this.result = null;
    this.executed = false;
  }

  uctValue(parentVisits, explorationConstant = 1.414) {
    if (this.visits === 0) return Infinity;
    const exploitation = this.reward / this.visits;
    const exploration = explorationConstant * Math.sqrt(
      Math.log(parentVisits) / this.visits
    );
    return exploitation + exploration;
  }

  compositeScore() {
    const preWeight = 0.3;
    const postWeight = 0.4;
    const rewardWeight = 0.3;
    const avgReward = this.visits > 0 ? this.reward / this.visits : 0;
    return preWeight * this.preScore + postWeight * this.postScore + rewardWeight * avgReward;
  }

  isLeaf() {
    return this.children.length === 0 || this.children.every(c => c.pruned);
  }

  activeChildren() {
    return this.children.filter(c => !c.pruned);
  }

  bestChild() {
    const active = this.activeChildren();
    if (active.length === 0) return null;
    return active.reduce((best, c) =>
      c.compositeScore() > best.compositeScore() ? c : best
    );
  }

  getPath() {
    const path = [];
    let node = this;
    while (node) {
      if (node.tool) path.unshift({ tool: node.tool, args: node.args, score: node.compositeScore() });
      node = node.parent;
    }
    return path;
  }
}

// ---------------------------------------------------------------------------
// PreEvaluator — 快速 schema/slot 檢查（不執行工具）
// ---------------------------------------------------------------------------
class PreEvaluator {
  constructor(availableTools = []) {
    this.tools = availableTools;
    this._toolMap = new Map();
    for (const t of availableTools) {
      this._toolMap.set(t.name, t);
    }
  }

  evaluate(toolName, taskContext = {}) {
    const tool = this._toolMap.get(toolName);
    if (!tool) return 0;

    let score = 0.5;
    if (tool.inputSchema) {
      score += this._checkSchemaCompatibility(tool.inputSchema, taskContext);
    }
    score += this._checkKeywordMatch(tool, taskContext.goal || '');
    score += this._checkOutputMatch(tool, taskContext.requiredOutputs || []);

    if (taskContext.previousResults) {
      const prevTools = taskContext.previousResults.map(r => r.tool);
      if (prevTools.includes(toolName)) score -= 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  _checkSchemaCompatibility(schema, context) {
    let bonus = 0;
    const required = schema.required || [];
    for (const req of required) {
      if (context[req] || (context.args && context.args[req])) bonus += 0.1;
    }
    return bonus;
  }

  _checkKeywordMatch(tool, goal) {
    const desc = (tool.description || '').toLowerCase();
    const goalLower = goal.toLowerCase();
    const keywordMap = [
      { cats: ['search', 'grep', 'find', 'query', '搜尋', '尋找'], tools: ['grep', 'search', 'query', 'find'] },
      { cats: ['analyze', 'learn', 'understand', '分析', '理解'], tools: ['learn', 'analyze', 'review'] },
      { cats: ['edit', 'apply', 'patch', 'write', '編輯', '修改'], tools: ['edit', 'apply', 'patch', 'write'] },
      { cats: ['test', 'verify', 'check', '測試', '驗證'], tools: ['test', 'verify', 'check'] },
      { cats: ['security', 'vulnerability', '安全', '漏洞'], tools: ['security', 'scan'] },
      { cats: ['debug', 'error', 'diagnose', '除錯', '錯誤'], tools: ['debug', 'diagnose', 'error'] },
      { cats: ['refactor', 'rename', 'restructure', '重構'], tools: ['refactor', 'rename'] },
      { cats: ['plan', 'workflow', '規劃', '流程'], tools: ['plan', 'workflow', 'compose'] },
      { cats: ['memory', 'remember', 'store', '記憶'], tools: ['memory', 'store'] },
    ];
    for (const entry of keywordMap) {
      const descMatch = entry.tools.some(t => desc.includes(t));
      const goalMatch = entry.cats.some(k => goalLower.includes(k));
      if (descMatch && goalMatch) return 0.15;
    }
    return 0;
  }

  _checkOutputMatch(tool, requiredOutputs) {
    if (requiredOutputs.length === 0) return 0;
    const desc = (tool.description || '').toLowerCase();
    let matchCount = requiredOutputs.filter(o => desc.includes(o.toLowerCase())).length;
    return matchCount > 0 ? 0.1 * (matchCount / requiredOutputs.length) : 0;
  }
}

// ---------------------------------------------------------------------------
// PostEvaluator — 根據執行結果評分工具貢獻
// ---------------------------------------------------------------------------
class PostEvaluator {
  evaluate(result, taskContext = {}) {
    if (!result) return 0;
    let score = 0;
    if (result.ok !== false) score += 0.3;

    const output = result.output || result.result || '';
    if (typeof output === 'string' && output.length > 50) score += 0.2;
    else if (typeof output === 'object' && output !== null && Object.keys(output).length > 0) score += 0.2;

    if (taskContext.goal && typeof output === 'string') {
      const goalWords = taskContext.goal.toLowerCase().split(/\s+/);
      const outputLower = output.toLowerCase();
      const matchCount = goalWords.filter(w => outputLower.includes(w)).length;
      if (matchCount > 0) score += 0.15 * Math.min(1, matchCount / goalWords.length);
    }
    if (!result.error && !result.stderr) score += 0.15;
    if (!result.timedOut) score += 0.1;
    if (result.findings || result.suggestions || result.matches) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }
}

// ---------------------------------------------------------------------------
// BidirectionalPruner — 雙向剪枝
// ---------------------------------------------------------------------------
class BidirectionalPruner {
  constructor(options = {}) {
    this.preThreshold = options.preThreshold || 0.2;
    this.postThreshold = options.postThreshold || 0.15;
    this.maxDepth = options.maxDepth || 8;
    this.maxChildren = options.maxChildren || 5;
  }

  prePrune(node, candidates) {
    return candidates
      .filter(c => {
        if (node.depth >= this.maxDepth) return false;
        if (c.preScore < this.preThreshold) return false;
        return true;
      })
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, this.maxChildren);
  }

  postPrune(node) {
    for (const child of node.children) {
      if (child.pruned) continue;
      if (child.postScore < this.postThreshold && child.executed) {
        child.pruned = true;
        child.pruneReason = `postScore ${child.postScore.toFixed(2)} < ${this.postThreshold}`;
        continue;
      }
      if (child.depth >= this.maxDepth) {
        child.pruned = true;
        child.pruneReason = `depth ${child.depth} >= max ${this.maxDepth}`;
      }
    }
    const active = node.activeChildren();
    if (active.length > this.maxChildren) {
      const sorted = [...active].sort((a, b) => b.compositeScore() - a.compositeScore());
      for (let i = this.maxChildren; i < sorted.length; i++) {
        sorted[i].pruned = true;
        sorted[i].pruneReason = `exceeds maxChildren ${this.maxChildren}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MCTSPlanner — MCTS 搜尋引擎
// ---------------------------------------------------------------------------
class MCTSPlanner {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 100;
    this.timeout = options.timeout || 30000;
    this.explorationConstant = options.explorationConstant || 1.414;
    this.convergenceThreshold = options.convergenceThreshold || 0.01;
    this.convergenceWindow = options.convergenceWindow || 10;

    this.preEvaluator = new PreEvaluator(options.availableTools || []);
    this.postEvaluator = new PostEvaluator();
    this.pruner = new BidirectionalPruner({
      preThreshold: options.preThreshold,
      postThreshold: options.postThreshold,
      maxDepth: options.maxDepth,
      maxChildren: options.maxChildren,
    });

    this.root = null;
    this.nodeCounter = 0;
    this.bestPath = null;
    this.bestScore = 0;
    this.scoreHistory = [];
    this.startTime = 0;
    this.iterations = 0;
    this.converged = false;
  }

  async search({ goal, availableTools, context = {}, executeTool }) {
    this.startTime = Date.now();
    this.iterations = 0;
    this.converged = false;
    this.scoreHistory = [];
    this.bestScore = 0;
    this.bestPath = null;
    this.nodeCounter = 0;

    // Update pre-evaluator with available tools
    this.preEvaluator = new PreEvaluator(availableTools);
    this.root = new UCTNode({ id: this._nextId(), tool: null, args: {}, depth: 0 });

    const taskContext = { goal, ...context };
    let stableCount = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      if (Date.now() - this.startTime > this.timeout) break;
      this.iterations = i + 1;

      // 1. Selection
      const leaf = this._select(this.root);

      // 2. Pre-evaluation + Expansion
      const preCandidates = this._preEvaluate(availableTools, taskContext, leaf);
      const filtered = this.pruner.prePrune(leaf, preCandidates);

      for (const cand of filtered) {
        const child = new UCTNode({
          id: this._nextId(),
          tool: cand.tool,
          args: cand.args || {},
          parent: leaf,
          depth: leaf.depth + 1,
        });
        child.preScore = cand.preScore;
        leaf.children.push(child);
      }

      const bestChild = leaf.bestChild();
      if (!bestChild) continue;

      // 3. Simulation (execute)
      if (!bestChild.executed && executeTool) {
        try {
          bestChild.result = await executeTool(bestChild.tool, bestChild.args);
        } catch (err) {
          bestChild.result = { ok: false, error: err.message };
        }
        bestChild.executed = true;
        bestChild.postScore = this.postEvaluator.evaluate(bestChild.result, taskContext);
      }

      if (!bestChild.executed) {
        bestChild.postScore = bestChild.preScore * 0.5;
      }

      // 4. Back-propagation
      this._backPropagate(bestChild, bestChild.postScore);

      // 5. Post-pruning
      this.pruner.postPrune(bestChild.parent || this.root);

      // Track best path
      const currentBest = this._findBestPath(this.root);
      if (currentBest && currentBest.score > this.bestScore) {
        this.bestScore = currentBest.score;
        this.bestPath = currentBest.path;
      }

      // Convergence check
      this.scoreHistory.push(this.bestScore);
      if (this.scoreHistory.length > this.convergenceWindow) {
        this.scoreHistory.shift();
      }
      if (this.scoreHistory.length >= this.convergenceWindow) {
        const maxScore = Math.max(...this.scoreHistory);
        const minScore = Math.min(...this.scoreHistory);
        if (maxScore > 0 && (maxScore - minScore) / maxScore < this.convergenceThreshold) {
          stableCount++;
          if (stableCount >= 3) {
            this.converged = true;
            break;
          }
        } else {
          stableCount = 0;
        }
      }
    }

    return this._buildResult();
  }

  _select(node) {
    let current = node;
    while (!current.isLeaf() && current.children.length > 0) {
      const active = current.activeChildren();
      if (active.length === 0) break;
      current = active.reduce((best, child) => {
        const uct = child.uctValue(current.visits, this.explorationConstant);
        const bestUct = best.uctValue(current.visits, this.explorationConstant);
        return uct > bestUct ? child : best;
      });
    }
    return current;
  }

  _preEvaluate(tools, taskContext, leaf) {
    const parentPath = leaf.getPath();
    const previousResults = parentPath.filter(p => p.tool).map(p => ({
      tool: p.tool,
      result: p.result,
    }));

    const context = { ...taskContext, previousResults };
    return tools.map(t => {
      const toolName = typeof t === 'string' ? t : t.name;
      const toolDef = typeof t === 'object' && t.name ? t : { name: toolName, description: '', inputSchema: null };
      const preScore = this.preEvaluator.evaluate(toolName, { ...context, ...toolDef });
      const args = this._inferArgs(toolDef, taskContext);
      return { tool: toolName, preScore, args };
    });
  }

  _inferArgs(toolDef, taskContext) {
    const args = {};
    const schema = toolDef.inputSchema;
    if (!schema || !schema.properties) return args;
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (taskContext[key]) {
        args[key] = taskContext[key];
      } else if (taskContext.args && taskContext.args[key]) {
        args[key] = taskContext.args[key];
      }
    }
    return args;
  }

  _backPropagate(node, score) {
    let current = node;
    while (current) {
      current.visits++;
      current.reward += score;
      current = current.parent;
    }
  }

  _findBestPath(node) {
    if (!node || node.isLeaf()) {
      const path = node ? node.getPath() : [];
      return { path, score: node ? node.compositeScore() : 0 };
    }
    let best = null;
    for (const child of node.activeChildren()) {
      const result = this._findBestPath(child);
      if (!best || result.score > best.score) {
        best = result;
      }
    }
    if (!best) {
      return { path: node.getPath(), score: node.compositeScore() };
    }
    return best;
  }

  _nextId() {
    return ++this.nodeCounter;
  }

  _buildResult() {
    const elapsed = Date.now() - this.startTime;
    const totalNodes = this._countNodes(this.root);
    const prunedNodes = this._countPruned(this.root);

    return {
      path: this.bestPath || [],
      score: this.bestScore,
      iterations: this.iterations,
      converged: this.converged,
      elapsed: elapsed,
      stats: {
        totalNodes,
        prunedNodes,
        activeNodes: totalNodes - prunedNodes,
        avgBranching: this.iterations > 0 ? (totalNodes / this.iterations).toFixed(2) : 0,
      },
    };
  }

  _countNodes(node) {
    if (!node) return 0;
    return 1 + node.children.reduce((sum, c) => sum + this._countNodes(c), 0);
  }

  _countPruned(node) {
    if (!node) return 0;
    return (node.pruned ? 1 : 0) + node.children.reduce((sum, c) => sum + this._countPruned(c), 0);
  }

  /** Get static fallback recommendation (no MCTS) */
  static fallbackRecommendation(goal, availableToolNames = []) {
    const goalLower = goal.toLowerCase();

    // Simple keyword → tool chain mapping
    const chains = {
      debug: ['smart_grep', 'smart_error_diagnose', 'smart_cross_file_edit', 'smart_test'],
      refactor: ['smart_learn', 'smart_import_graph', 'smart_rename_safety', 'smart_cross_file_edit', 'smart_test'],
      security: ['smart_security', 'smart_grep', 'smart_cross_file_edit', 'smart_test'],
      test: ['smart_test', 'smart_coverage'],
      search: ['smart_grep', 'smart_exa_search'],
      git: ['smart_git_context', 'smart_git_commit', 'smart_git_review', 'smart_git_pr'],
      plan: ['smart_planner', 'smart_workflow'],
      document: ['smart_ingest_document', 'smart_list_documents', 'smart_search_docs'],
      research: ['smart_exa_search', 'smart_exa_crawl', 'smart_ingest_document'],
    };

    for (const [key, chain] of Object.entries(chains)) {
      if (goalLower.includes(key)) {
        const filtered = chain.filter(t => availableToolNames.length === 0 || availableToolNames.includes(t));
        return {
          path: filtered.map(t => ({ tool: t, args: {}, score: 1 })),
          score: 1,
          iterations: 0,
          converged: false,
          elapsed: 0,
          stats: { note: 'static fallback (no MCTS search)' },
        };
      }
    }

    return {
      path: [{ tool: 'smart_think', args: {}, score: 1 }, { tool: 'smart_planner', args: {}, score: 0.5 }],
      score: 0.5,
      iterations: 0,
      converged: false,
      elapsed: 0,
      stats: { note: 'default fallback (no matching chain)' },
    };
  }
}

export { MCTSPlanner, UCTNode, PreEvaluator, PostEvaluator, BidirectionalPruner };
