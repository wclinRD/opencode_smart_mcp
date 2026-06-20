#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// thinking.mjs — Structured Reasoning & Problem Analysis CLI
//
// Helps break down problems using structured thinking templates.
// Supports multiple reasoning patterns for different task types.
// v3.1 — Added dynamic multi-step reasoning with state persistence.
//
// Usage:
//   Static mode:   node thinking.mjs <topic> [options]
//   Dynamic mode:  node thinking.mjs --dynamic "topic" --template debug [--state <path>]
//   Record result: node thinking.mjs --record <stepIdx> "result" --state <path>
//   Advance step:  node thinking.mjs --advance --state <path>
//   Branch:        node thinking.mjs --branch <branchName> --state <path>
//   Status:        node thinking.mjs --status --state <path>
//   Finish:        node thinking.mjs --finish --state <path>
//   Restore:       node thinking.mjs --restore <path>
//
// Templates:
//   debug       Debug analysis: error → root cause → fix → verify
//   refactor    Refactoring plan: deps → naming → safety → changes
//   feature     Feature design: requirements → arch → impl → verify
//   research    Research plan: search → analyze → compare → conclude
//   decision    Decision analysis: options → pros/cons → recommendation
//   analyze     General analysis: context → breakdown → insights
//   plan_executePlan & execute: review → execute → verify → next
//   retrospect  Self-reflection: goal → process → learnings → actions
//   architectureArchitecture decision: constraints → trade-offs → decision

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES = {
  debug: {
    name: 'Debug Analysis',
    description: 'Systematic debug workflow: classify error → trace root cause → design fix → verify',
    steps: [
      { name: 'Error Classification', icon: '1', prompt: 'Classify the error: syntax/runtime/logic/environment. Collect exit code, stderr, stack trace.' },
      { name: 'Root Cause Analysis', icon: '2', prompt: 'Trace data/control flow from error location backward. Identify the fundamental cause, not symptoms.' },
      { name: 'Minimal Reproduction', icon: '3', prompt: 'Design minimal steps or test case to reliably reproduce the bug.' },
      { name: 'Fix Design', icon: '4', prompt: 'Design the fix. Consider edge cases. What needs to change and where?' },
      { name: 'Verification & Regression', icon: '5', prompt: 'How to verify the fix works? What other tests to run for regression?' },
    ],
  },

  refactor: {
    name: 'Refactoring Plan',
    description: 'Safe refactor workflow: dependency analysis → naming → safety → execute → verify',
    steps: [
      { name: 'Dependency Analysis', icon: '1', prompt: 'Find all references and callers. Mark public API boundaries that cannot break.' },
      { name: 'Convention Check', icon: '2', prompt: 'What naming conventions and patterns exist? Ensure new names follow project style.' },
      { name: 'Safety Scan', icon: '3', prompt: 'Check for credential leaks, injection risks, and API compatibility issues.' },
      { name: 'Execution Plan', icon: '4', prompt: 'List files to modify in dependency order. Each file: what changes, in what order.' },
      { name: 'Verification', icon: '5', prompt: 'Test before/after comparison. Lint, typecheck, test suite. No regression allowed.' },
    ],
  },

  feature: {
    name: 'Feature Design',
    description: 'New feature workflow: clarify requirements → design → implement → verify',
    steps: [
      { name: 'Requirement Clarification', icon: '1', prompt: 'Define the goal in one sentence. List acceptance criteria. Mark unclear requirements.' },
      { name: 'Architecture Design', icon: '2', prompt: 'Understand existing architecture. Decide file placement, API signatures, data structures.' },
      { name: 'Implementation Plan', icon: '3', prompt: 'Break into phases: skeleton → core logic → edge cases → polish. Follow project conventions.' },
      { name: 'Quality Gates', icon: '4', prompt: 'Lint → typecheck → test → security scan. Cross-file consistency check.' },
      { name: 'Completion', icon: '5', prompt: 'Update docs if needed. Generate meaningful commit message. Prepare for review.' },
    ],
  },

  research: {
    name: 'Research Investigation',
    description: 'Technical research workflow: search → analyze → compare → conclude',
    steps: [
      { name: 'Search & Gather', icon: '1', prompt: 'Search for relevant information. Read 3-5 primary sources. Extract key facts.' },
      { name: 'Deep Analysis', icon: '2', prompt: 'Read selected sources in depth. Extract features, limitations, versions, licenses.' },
      { name: 'Comparison', icon: '3', prompt: 'Build comparison table: features, performance, community health, compatibility.' },
      { name: 'Synthesis', icon: '4', prompt: 'Summarize findings in 1-3 paragraphs. What are the key takeaways?' },
      { name: 'Decision Record', icon: '5', prompt: 'Record the conclusion and rationale. Tag for future reference.' },
    ],
    // Example: research can branch based on findings
    branches: {
      'clear-answer': {
        label: 'Clear answer found',
        description: 'Sufficient info found early. Skip remaining search steps.',
        skipToStep: 3, // skip to Synthesis
      },
      'needs-deeper': {
        label: 'Needs deeper investigation',
        description: 'Initial search insufficient. Add deeper analysis steps.',
        extraSteps: [
          { name: 'Expert Consultation', icon: '2b', prompt: 'Identify domain experts or primary sources to consult. Look for official docs, RFCs, or maintainer comments.' },
          { name: 'Implementation Deep Dive', icon: '2c', prompt: 'Read source code or experimental results. Verify claims with concrete examples.' },
        ],
      },
    },
  },

  decision: {
    name: 'Decision Analysis',
    description: 'Structured decision framework: options → pros/cons → weighted analysis → recommendation',
    steps: [
      { name: 'Define Decision', icon: '1', prompt: 'What decision needs to be made? What are the constraints and success criteria?' },
      { name: 'List Options', icon: '2', prompt: 'Enumerate all viable options. Include "do nothing" as baseline.' },
      { name: 'Pros & Cons', icon: '3', prompt: 'For each option, list advantages, disadvantages, and risks.' },
      { name: 'Evaluation', icon: '4', prompt: 'Weight criteria by importance. Score each option. Identify trade-offs.' },
      { name: 'Recommendation', icon: '5', prompt: 'Recommend the best option with rationale. Mention risks and mitigation.' },
    ],
    branches: {
      'quick-decision': {
        label: 'Quick decision possible',
        description: 'Clear winner exists. Skip detailed evaluation.',
        skipToStep: 4, // jump straight to Recommendation
      },
      'needs-tradeoff': {
        label: 'Complex trade-off analysis',
        description: 'Options are close. Add weighted scoring step.',
        extraSteps: [
          { name: 'Weighted Scoring', icon: '3b', prompt: 'Create a decision matrix. Assign weights (1-5) to each criterion. Score each option. Calculate weighted totals.' },
        ],
      },
    },
  },

  analyze: {
    name: 'General Analysis',
    description: 'General structured analysis: context → breakdown → hypothesis → insights',
    steps: [
      { name: 'Context Understanding', icon: '1', prompt: 'What is the topic? What is the goal? What constraints exist?' },
      { name: 'Break Down', icon: '2', prompt: 'Decompose the problem into smaller, manageable sub-problems.' },
      { name: 'Generate Hypotheses', icon: '3', prompt: 'Formulate 1-3 hypotheses or possible approaches. What predictions do they make?' },
      { name: 'Evaluate', icon: '4', prompt: 'Test each hypothesis against available information. What supports or contradicts each?' },
      { name: 'Synthesize', icon: '5', prompt: 'Summarize findings, conclusions, and recommended next steps.' },
    ],
    branches: {
      'hypothesis-confirmed': {
        label: 'Hypothesis confirmed',
        description: 'One hypothesis strongly supported. Move to synthesis.',
        skipToStep: 4,
      },
      'needs-more-data': {
        label: 'Insufficient data',
        description: 'No clear hypothesis. Need more information gathering.',
        extraSteps: [
          { name: 'Extended Research', icon: '3b', prompt: 'Identify knowledge gaps. What specific information is missing? Where to find it? Search and gather.' },
        ],
      },
    },
  },

  // Plan + Execute — connects with planner output
  plan_execute: {
    name: 'Plan & Execute',
    description: 'Iterative plan-execute-review cycle. Use with planner output to execute plans step by step.',
    steps: [
      { name: 'Review Plan', icon: '1', prompt: 'Review the generated plan. Understand each step\'s purpose and dependencies.' },
      { name: 'Execute Step', icon: '2', prompt: 'Execute the next pending step. Choose the right smart with correct arguments.' },
      { name: 'Verify Result', icon: '3', prompt: 'Check if the step completed successfully. If failed, decide on retry or replan.' },
      { name: 'Update State', icon: '4', prompt: 'Update execution state. Mark step done. Update context for next step.' },
      { name: 'Next Step or Finish', icon: '5', prompt: 'If steps remain, go to step 2. If all done, summarize results.' },
    ],
  },

  // Retrospect — self-reflection for meta-learning
  retrospect: {
    name: 'Retrospective Analysis',
    description: 'Self-reflection on completed tasks: what worked, what didn\'t, what to remember.',
    steps: [
      { name: 'Goal Review', icon: '1', prompt: 'What was the original goal? Was it achieved? Was the scope accurate?' },
      { name: 'Process Analysis', icon: '2', prompt: 'What steps were taken? Which tools were used? What was the actual vs planned sequence?' },
      { name: 'Successes & Failures', icon: '3', prompt: 'What worked well? What failed? Why did things fail? Was there a pattern?' },
      { name: 'Key Learnings', icon: '4', prompt: 'What should be remembered for next time? What patterns or solutions are reusable?' },
      { name: 'Action Items', icon: '5', prompt: 'What should be done differently next time? Any improvements to process or tools?' },
    ],
  },

  // Architecture Decision — specifically for technical architecture choices
  architecture: {
    name: 'Architecture Decision',
    description: 'Technical architecture decision framework: constraints → options → trade-offs → decision',
    steps: [
      { name: 'Constraints & Requirements', icon: '1', prompt: 'List all constraints: performance, scalability, security, cost, team expertise, timeline.' },
      { name: 'Architecture Options', icon: '2', prompt: 'Enumerate 2-4 viable architecture approaches. Include a simple/baseline option.' },
      { name: 'Trade-off Analysis', icon: '3', prompt: 'For each option: pros, cons, risks, and unknown unknowns. Be honest about complexity.' },
      { name: 'Decision with Rationale', icon: '4', prompt: 'Choose the best option. State why it was chosen over alternatives explicitly.' },
      { name: 'Implementation Guidance', icon: '5', prompt: 'First steps to implement. What to build first? What to defer? Key design decisions within the chosen arch.' },
    ],
  },

  // Peer Review — academic manuscript review (Remi 10-point framework)
  peer_review: {
    name: 'Peer Review (Remi)',
    description: 'Nature/Science-level academic peer review: 10-point framework covering quality, methodology, consistency, results, presentation, literature, impact, tone, issues, and recommendation.',
    steps: [
      { name: 'Quality & Novelty', icon: '1', prompt: 'Is the research question important and clearly defined? Is the contribution novel or incremental? Does it advance the field meaningfully?' },
      { name: 'Methodology & Assumptions', icon: '2', prompt: 'Are the methods appropriate and well-justified? Identify hidden assumptions, unrealistic simplifications, methodological gaps, missing controls, or biases. Is the data sufficient and reliable?' },
      { name: 'Consistency & Coherence', icon: '3', prompt: 'Identify inconsistencies between sections (abstract, methods, results, conclusions). Check logical flow and internal contradictions.' },
      { name: 'Results & Interpretation', icon: '4', prompt: 'Are results correctly interpreted or overstated? Are claims supported by data? Any overfitting, selective reporting, or exaggeration?' },
      { name: 'Presentation & Tone', icon: '5', prompt: 'Are figures clear and publication-ready? Flag AI vocabulary (delve, tapestry, crucial, etc.). Strip meta-commentary and self-referential writing. Final recommendation: Accept/Minor/Major/Reject.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Programmatic API — quickThought (lightweight conversational reasoning)
// ---------------------------------------------------------------------------

/**
 * Advanced conversational reasoning — surpasses sequential-thinking.
 *
 * Features:
 *  - Hypothesis generation + verification cycle
 *  - Dynamic total adjustment mid-stream
 *  - needsMoreThoughts for beyond-initial-plan exploration
 *  - Revision with explicit cross-reference
 *  - Branching with named paths
 *  - Optional template guidance (9 templates)
 *
 * @param {object} args
 * @param {string} args.thought — current reasoning step content
 * @param {boolean} args.nextThoughtNeeded — whether more thinking needed
 * @param {number} [args.thoughtNumber] — current step (default: 1)
 * @param {number} [args.totalThoughts] — total steps (default: 1)
 * @param {string} [args.hypothesis] — hypothesis to test (triggers hypothesis section)
 * @param {string} [args.verification] — verification result (triggers verify section)
 * @param {boolean} [args.needsMoreThoughts] — signal need for more steps beyond total
 * @param {number} [args.adjustTotalThoughts] — adjust total upward mid-stream
 * @param {boolean} [args.isRevision] — revising previous thought
 * @param {number} [args.revisesThought] — which thought being revised
 * @param {number} [args.branchFromThought] — branching from which thought
 * @param {string} [args.branchId] — branch identifier
 * @param {string} [args.template] — optional template name for guidance
 * @returns {{ output: string, done: boolean, totalThoughts?: number }}
 */
export function quickThought(args) {
  const {
    thought = '',
    nextThoughtNeeded = false,
    thoughtNumber = 1,
    totalThoughts = 1,
    hypothesis = null,
    verification = null,
    needsMoreThoughts = false,
    adjustTotalThoughts = null,
    isRevision = false,
    revisesThought = null,
    branchFromThought = null,
    branchId = null,
    template = null,
    mode = null,      // "beam" | "cit" | "forest" | "structured"
    beams = null,     // Pre-parsed beam paths (array of {name, content, confidence?})
    selectedBeam = null, // Name of the selected beam path
    branchingNeeded = null, // CiT BN-DP: true=need branch, false=chain
    branchReasoning = null, // CiT BN-DP: why branching is/isn't needed
    trees = null,     // FoT: array of {name, branches: [{name, content, confidence}], selectedBranch}
    consensus = null, // FoT: {conclusion, agreeingTrees, totalTrees, confidence}
    // Structured thinking fields (mode:"structured")
    goal = null,      // GOAL: one-sentence objective
    state = null,     // STATE: known information and context
    algo = null,      // ALGO: reasoning path and method
    edge = null,      // EDGE: boundary conditions and constraints
    verify = null,    // VERIFY: self-verification logic
  } = args;

  const effectiveTotal = adjustTotalThoughts ?? totalThoughts;
  const lines = [];

  // ── Header ──
  const prefix = isRevision ? '↺ Revising' : 'Thought';
  const adjusted = adjustTotalThoughts ? ` (was ${totalThoughts}, now ${effectiveTotal})` : '';
  lines.push(`${prefix} ${thoughtNumber}/${effectiveTotal}${adjusted}:`);
  lines.push('');

  // ── Metadata blocks ──
  if (isRevision && revisesThought !== null) {
    lines.push(`┐ Revision of thought ${revisesThought}`);
    lines.push('');
  }

  if (branchFromThought !== null && branchId) {
    lines.push(`┐ Branch from thought ${branchFromThought}: ${branchId}`);
    lines.push('');
  }

  if (needsMoreThoughts) {
    lines.push(`┐ More thoughts needed beyond initial plan`);
    lines.push('');
  }

  // ── Hypothesis block ──
  if (hypothesis) {
    lines.push(`┌─ Hypothesis ──────────────────────────────`);
    lines.push(`│ ${hypothesis}`);
    lines.push(`└───────────────────────────────────────────`);
    lines.push('');
  }

  // ── Verification block ──
  if (verification) {
    const verdict = verification.startsWith('✓') || verification.startsWith('✗')
      ? ''
      : verification.toLowerCase().includes('confirm') || verification.toLowerCase().includes('true') || verification.toLowerCase().includes('correct')
        ? ' ✓'
        : verification.toLowerCase().includes('reject') || verification.toLowerCase().includes('false') || verification.toLowerCase().includes('wrong')
          ? ' ✗'
          : '';
    lines.push(`┌─ Verification ${verdict} ───────────────────`);
    lines.push(`│ ${verification}`);
    lines.push(`└───────────────────────────────────────────`);
    lines.push('');
  }

  // ── Forest-of-Thought block ──
  if (mode === 'forest') {
    const treeList = Array.isArray(trees) ? trees : [];

    if (treeList.length > 0) {
      const totalBranches = treeList.reduce((sum, t) => sum + (t.branches?.length || 0), 0);

      // Forest overview
      lines.push(`┌─ Forest-of-Thought (${treeList.length} trees, ${totalBranches} branches) ──`);
      for (const tree of treeList) {
        const bCount = tree.branches?.length || 0;
        const sel = tree.selectedBranch || '';
        const marker = consensus?.primaryTree === tree.name ? '→' : ' ';
        lines.push(`│ ${marker} ${tree.name} (${bCount} branches)${sel ? ` → ${sel}` : ''}`);
      }
      lines.push(`└───────────────────────────────────────────────────────`);
      lines.push('');

      // Per-tree details
      for (const tree of treeList) {
        const branches = Array.isArray(tree.branches) ? tree.branches : [];
        if (branches.length > 0) {
          lines.push(`┌─ ${tree.name} ─────────────────────────────────────`);
          for (const br of branches) {
            const marker = br.name === tree.selectedBranch ? '→' : ' ';
            const conf = br.confidence != null ? ` (conf: ${br.confidence}/10)` : '';
            lines.push(`│ ${marker} ${br.name}${conf}`);
          }
          lines.push(`└────────────────────────────────────────────────────`);
          lines.push('');

          // Show selected branch content
          const selected = branches.find(b => b.name === tree.selectedBranch);
          if (selected) {
            lines.push(`[${tree.name} → ${selected.name}]`);
            lines.push('');
            lines.push(selected.content);
            lines.push('');
          }
        }
      }

      // Consensus
      if (consensus) {
        lines.push(`┌─ Forest Consensus ─────────────────────`);
        lines.push(`│ ${consensus.conclusion}`);
        if (consensus.agreeingTrees) {
          const agreeList = Array.isArray(consensus.agreeingTrees) ? consensus.agreeingTrees : [];
          lines.push(`│ Agreement: ${agreeList.length}/${consensus.totalTrees || treeList.length} trees`);
          for (const t of agreeList) {
            lines.push(`│  ✓ ${t}`);
          }
        }
        if (consensus.confidence != null) {
          lines.push(`│ Overall confidence: ${consensus.confidence}/10`);
        }
        lines.push(`└──────────────────────────────────────────`);
        lines.push('');
      }

      // ── Trace Synthesis: combine complementary insights across trees ──
      const selectedBranches = treeList
        .map(tree => {
          const sel = tree.branches?.find(b => b.name === tree.selectedBranch);
          return sel ? { tree: tree.name, branch: sel.name, content: sel.content, confidence: sel.confidence } : null;
        })
        .filter(Boolean);

      if (selectedBranches.length >= 2) {
        const highConf = selectedBranches.filter(sb => (sb.confidence || 5) >= 7);
        const partialConf = selectedBranches.filter(sb => (sb.confidence || 5) < 7);

        lines.push(`┌─ Trace Synthesis ───────────────────────`);
        lines.push(`│ Combined from ${selectedBranches.length} reasoning trees:`);
        for (const sb of selectedBranches) {
          const sentences = sb.content.split(/[.!?\n]/).filter(s => s.trim().length > 10);
          const lead = sentences[0]?.trim() || '(key insight)';
          lines.push(`│`);
          lines.push(`│ [${sb.tree}] ${lead}`);
          if (sentences[1]) {
            const second = sentences[1].trim();
            if (second.length > 0) lines.push(`│          ${second}`);
          }
        }
        lines.push(`│`);
        if (highConf.length === selectedBranches.length) {
          lines.push(`│ ✓ All trees converge at high confidence — unified conclusion`);
        } else if (highConf.length >= Math.ceil(selectedBranches.length / 2)) {
          lines.push(`│ ⚠ Majority convergence (${highConf.length}/${selectedBranches.length} high-confidence)`);
        } else {
          lines.push(`│ ⚠ Low convergence — consider deeper analysis on divergent areas`);
        }
        if (partialConf.length > 0) {
          lines.push(`│ ⚠ Lower confidence in: ${partialConf.map(sb => sb.tree).join(', ')}`);
        }
        lines.push(`└──────────────────────────────────────────`);
        lines.push('');
      }
    } else {
      // Fallback: no structured trees
      lines.push(`┌─ Forest-of-Thought ───────────────────────`);
      lines.push(`│ Multiple reasoning trees explored below`);
      lines.push(`└──────────────────────────────────────────────`);
      lines.push('');
      lines.push(thought);
      lines.push('');
    }
  // ── CiT / Beam Search block ──
  } else if (mode === 'beam' || mode === 'cit') {
    // --- BN-DP Assessment (CiT only) ---
    if (mode === 'cit') {
      const needsBranch = branchingNeeded === true;
      const branchLabel = needsBranch ? 'YES → branch' : 'NO → chain';
      lines.push(`┌─ CiT BN-DP ─────────────────────────────`);
      lines.push(`│ Branch: ${branchLabel}`);
      if (branchReasoning) {
        lines.push(`│ ${branchReasoning}`);
      }
      lines.push(`└───────────────────────────────────────────`);
      lines.push('');
    }

    // --- Chain mode (CiT, no branching needed) ---
    if (mode === 'cit' && branchingNeeded !== true) {
      lines.push(`[Chain] Single reasoning path — no branch needed.`);
      lines.push('');
      lines.push(thought);
      lines.push('');
    }
    // --- Branch mode (beam or CiT with branching) ---
    else {
      const pathList = Array.isArray(beams) ? beams : [];
      if (pathList.length > 0) {
        const label = mode === 'cit' ? 'Branching' : 'Beam Search';
        lines.push(`┌─ ${label} (${pathList.length} paths) ───────────────`);
        for (const beam of pathList) {
          const marker = beam.name === selectedBeam ? '→' : ' ';
          const conf = beam.confidence != null ? ` (confidence: ${beam.confidence}/10)` : '';
          lines.push(`│ ${marker} ${beam.name}${conf}`);
        }
        lines.push(`└────────────────────────────────────────────────────`);
        lines.push('');
        // Show the selected beam's content as main thought
        const selected = pathList.find(b => b.name === selectedBeam);
        if (selected) {
          lines.push(`[Selected: ${selected.name}]`);
          lines.push('');
          lines.push(selected.content);
        } else {
          lines.push(thought);
        }
        lines.push('');
        // Show beam/branch summary
        const sorted = [...pathList].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        if (sorted.length > 0) {
          const prefix = mode === 'cit' ? 'Branch' : 'Beam';
          lines.push(`─ ${prefix} Summary ─`);
          lines.push(`  Explored ${pathList.length} paths. Best: ${sorted[0].name} (${sorted[0].confidence || '?'}/10)`);
          lines.push('');
        }
      } else {
        // Fallback: no structured beams
        if (mode === 'beam') {
          lines.push(`┌─ Beam Search ───────────────────────────────────`);
          lines.push(`│ Multiple reasoning paths explored below`);
          lines.push(`└────────────────────────────────────────────────────`);
          lines.push('');
        }
        lines.push(thought);
        lines.push('');
      }
    }
    // Skip the normal main content below
  // ── Structured Thinking mode (Grammar-Constrained CoT) ──
  } else if (mode === 'structured') {
    const hasStructured = goal || state || algo || edge || verify;
    if (hasStructured) {
      lines.push(`┌─ Structured Thinking ─────────────────────`);
      if (goal) lines.push(`│ GOAL:  ${goal}`);
      if (state) lines.push(`│ STATE: ${state}`);
      if (algo) lines.push(`│ ALGO:  ${algo}`);
      if (edge) lines.push(`│ EDGE:  ${edge}`);
      if (verify) lines.push(`│ VERIFY: ${verify}`);
      lines.push(`└───────────────────────────────────────────`);
      lines.push('');
      // Append free-form thought as supplementary if provided
      if (thought && thought.trim()) {
        lines.push(`[Supplementary]`);
        lines.push(thought);
        lines.push('');
      }
    } else {
      // Fallback: no structured fields, treat as free-form
      lines.push(`┌─ Structured Thinking (free-form fallback) ──`);
      lines.push(`│ ${thought || '(no content)'}`);
      lines.push(`└──────────────────────────────────────────────`);
      lines.push('');
    }
  } else {
    // ── Main content (non-beam, non-cit, non-structured mode) ──
    lines.push(thought);
    lines.push('');
  }

  // ── Optional template guidance ──
  if (template && TEMPLATES[template]) {
    const t = TEMPLATES[template];
    const stepIndex = Math.min(thoughtNumber - 1, t.steps.length - 1);
    const step = t.steps[stepIndex];
    if (step) {
      lines.push(`─ ${t.name} guidance ─`);
      lines.push(`  Step ${stepIndex + 1}: ${step.name}`);
      lines.push(`  ${step.prompt}`);
      lines.push('');
    }
  }

  // ── Status indicator ──
  const isDone = !nextThoughtNeeded && !needsMoreThoughts;
  if (needsMoreThoughts) {
    const newTotal = adjustTotalThoughts
      ? effectiveTotal
      : Math.max(thoughtNumber + 2, totalThoughts + 2);
    lines.push(`↻ More reasoning needed... (adjusted total: ${newTotal})`);
    lines.push(`  ↳ Call again with totalThoughts=${newTotal}, thoughtNumber=${thoughtNumber + 1}`);
  } else if (nextThoughtNeeded) {
    lines.push(`→ Continue reasoning...`);
  } else {
    lines.push(`✓ Reasoning complete.`);
  }

  return {
    output: lines.join('\n'),
    done: isDone,
    totalThoughts: adjustTotalThoughts ? effectiveTotal : undefined,
  };
}

/**
 * Execute a state command on a thinking state file.
 * @param {string} statePath — path to state file
 * @param {object} cmd — { type: 'record'|'advance'|'branch'|'finish'|'status'|'cancel'|'restore', ... }
 * @returns {{ output: string, state?: object, error?: string }}
 */
export function execStateCommand(statePath, cmd) {
  try {
    const state = readState(statePath);
    const { type } = cmd;

    if (type === 'restore' || type === 'status') {
      const currentStep = getCurrentStep(state);
      const header = formatDynamicHeader(state, currentStep);
      const body = (currentStep && !state.completed)
        ? formatDynamicStep(currentStep, state)
        : state.completed ? formatDynamicSummary(state) : '';
      return { output: header + '\n' + body, state };
    }

    if (type === 'cancel') {
      state.cancelled = true;
      state.completed = true;
      writeState(statePath, state);
      return { output: 'Thinking session cancelled.', state };
    }

    if (type === 'finish') {
      for (const step of state.steps) {
        if (!step.completed) {
          step.completed = true;
          step.result = step.result || '[Skipped — session ended]';
        }
      }
      state.completed = true;
      state.currentStepIndex = state.steps.length;
      updateAccumulatedContext(state);
      writeState(statePath, state);
      return { output: formatDynamicSummary(state), state };
    }

    if (type === 'record') {
      const { index, result } = cmd;
      if (index < 0 || index >= state.steps.length) {
        return { error: `Invalid step index: ${index}. Steps: 0-${state.steps.length - 1}` };
      }
      state.steps[index].result = result;
      state.steps[index].completed = true;
      updateAccumulatedContext(state);
      writeState(statePath, state);

      let output = `✅ Recorded result for step ${index + 1} (${state.steps[index].name})`;

      if (cmd.advance || cmd.advance === undefined) {
        if (state.currentStepIndex <= index) {
          state.currentStepIndex = index + 1;
        }
        while (state.currentStepIndex < state.steps.length) {
          if (!state.steps[state.currentStepIndex].completed) break;
          state.currentStepIndex++;
        }
        writeState(statePath, state);
        const nextStep = getCurrentStep(state);
        if (!nextStep) {
          output += '\n\nAll steps completed.';
          output += '\n' + formatDynamicSummary(state);
        } else {
          output += `\n\nNow at step ${state.currentStepIndex + 1}: ${nextStep.name}\n`;
          output += '\n' + formatDynamicHeader(state, nextStep);
          output += '\n' + formatDynamicStep(nextStep, state);
        }
      }
      return { output, state };
    }

    if (type === 'advance') {
      const current = getCurrentStep(state);
      if (current && !current.completed) {
        current.completed = true;
        current.result = current.result || '[No result recorded, marked complete]';
        updateAccumulatedContext(state);
      }
      while (state.currentStepIndex < state.steps.length) {
        state.currentStepIndex++;
        if (state.currentStepIndex >= state.steps.length) break;
        if (!state.steps[state.currentStepIndex].completed) break;
      }
      writeState(statePath, state);

      const nextStep = getCurrentStep(state);
      let output;
      if (!nextStep) {
        output = 'All steps completed. Use --finish for summary.\n' + formatDynamicSummary(state);
      } else {
        output = formatDynamicHeader(state, nextStep) + '\n' + formatDynamicStep(nextStep, state);
      }
      return { output, state };
    }

    if (type === 'branch') {
      applyBranch(state, cmd.branchName);
      writeState(statePath, state);
      const currentStep = getCurrentStep(state);
      let output = `Branch selected: ${cmd.branchName}`;
      if (currentStep) {
        output += '\n\n' + formatDynamicHeader(state, currentStep);
        output += '\n' + formatDynamicStep(currentStep, state);
      } else {
        output += '\n\nAll steps completed in this branch.\n' + formatDynamicSummary(state);
      }
      return { output, state };
    }

    return { error: `Unknown state command: ${type}` };
  } catch (e) {
    return { error: `State command failed: ${e.message}` };
  }
}

/**
 * Create and start a new dynamic reasoning session.
 * @param {object} opts — { topic, template?, state?, plan? }
 * @returns {{ output: string, state: object, statePath: string, error?: string }}
 */
export function startDynamicSession(opts) {
  const statePath = opts.state || resolve(getDefaultStateDir(), 'thinking-state.json');
  const templateName = opts.template || 'analyze';

  if (!TEMPLATES[templateName]) {
    return { error: `Unknown template: ${templateName}`, output: '', state: null, statePath };
  }

  const state = createState(statePath, templateName, opts.topic);

  if (opts.plan) {
    const enriched = enrichStepsWithPlan(state.steps, { plan: opts.plan });
    state.steps = enriched;
    state.totalSteps = enriched.length;
  }

  writeState(statePath, state);

  const firstStep = getCurrentStep(state);
  const output = formatDynamicHeader(state, firstStep) + '\n' + formatDynamicStep(firstStep, state);
  return { output, state, statePath };
}

/**
 * Deep structured analysis with templates.
 * @param {object} opts
 * @param {string} opts.topic — analysis topic
 * @param {string} [opts.template] — template name (default: analyze)
 * @param {number} [opts.steps] — number of steps (default: 5)
 * @param {string} [opts.format] — output format: text|markdown|json (default: text)
 * @param {object} [opts.plan] — plan context
 * @param {number} [opts.planStep] — focus on specific plan step
 * @returns {{ output: string, type: string, error?: string }}
 */
export function deepAnalyze(opts) {
  const templateName = opts.template || 'analyze';
  if (!TEMPLATES[templateName]) {
    return { output: `Unknown template: ${templateName}`, type: 'error' };
  }

  const template = TEMPLATES[templateName];
  const topic = opts.topic || (opts.plan ? (opts.plan.goal || 'Plan execution') : '');
  const stepCount = opts.steps || 5;
  const format = opts.format || 'text';

  if (!topic && !opts.plan) {
    return { output: 'A topic is required.', type: 'error' };
  }

  let steps = template.steps.slice(0, stepCount);
  if (opts.plan) {
    steps = enrichStepsWithPlan(steps, {
      plan: opts.plan,
      planStepIndex: opts.planStep !== undefined ? opts.planStep - 1 : -1,
    });
  }

  let output;
  switch (format) {
    case 'json':
      output = formatJSON(template, topic, steps, opts);
      break;
    case 'markdown':
      output = formatMarkdown(template, topic, steps, opts);
      break;
    case 'text':
    default:
      output = formatText(template, topic, steps, opts);
      break;
  }

  return { output, type: 'static' };
}

// ---------------------------------------------------------------------------
// State management (dynamic multi-round reasoning)
// ---------------------------------------------------------------------------

let _state = null;
let _statePath = null;

function getDefaultStateDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const dir = resolve(home, '.smart');
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  return dir;
}

function stateTemplate(templateName, topic) {
  const template = TEMPLATES[templateName];
  const steps = template.steps.map((s, i) => ({
    index: i,
    name: s.name,
    prompt: s.prompt,
    result: null,
    completed: false,
    branchTaken: null,
  }));
  return {
    sessionId: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    template: templateName,
    templateDescription: template.description,
    topic,
    currentStepIndex: 0,
    totalSteps: steps.length,
    steps,
    branchHistory: [],
    accumulatedContext: '',
    branchActive: false,
    branchParentStep: null,
    completed: false,
    cancelled: false,
  };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createState(statePath, templateName, topic) {
  const state = stateTemplate(templateName, topic);
  writeState(statePath, state);
  return state;
}

function readState(statePath) {
  try {
    const raw = readFileSync(statePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error reading state file ${statePath}: ${e.message}`);
    process.exit(1);
  }
}

function writeState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  // Ensure directory exists
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing state file ${statePath}: ${e.message}`);
    process.exit(1);
  }
}

function updateAccumulatedContext(state) {
  const parts = [];
  for (const step of state.steps) {
    if (step.result) {
      parts.push(`Step ${step.index + 1} (${step.name}): ${step.result}`);
    }
  }
  state.accumulatedContext = parts.join('\n\n');
}

function getCurrentStep(state) {
  if (state.completed || state.currentStepIndex >= state.steps.length) {
    return null;
  }
  return state.steps[state.currentStepIndex];
}

// Build the prompt for current step, injecting accumulated context
function buildStepPrompt(state) {
  const step = getCurrentStep(state);
  if (!step) return null;

  let prompt = step.prompt;

  // Inject accumulated context
  if (state.accumulatedContext) {
    prompt += `\n\nPrevious findings:\n${state.accumulatedContext}`;
  }

  // Inject branch info if applicable
  if (state.branchActive) {
    const parentStep = state.steps.find(s => s.branchTaken);
    if (parentStep) {
      prompt += `\n\n[Branch mode: following "${parentStep.branchTaken}" from step ${parentStep.index + 1}]`;
    }
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Dynamic mode output
// ---------------------------------------------------------------------------

function formatDynamicHeader(state, step) {
  const lines = [];
  const tmpl = TEMPLATES[state.template];
  const progress = state.steps.filter(s => s.completed).length;
  const total = state.totalSteps;

  lines.push(`[${tmpl.name}] ${state.topic}`);
  lines.push(`Progress: ${progress}/${total} | ${state.template}`);
  if (state.branchActive) {
    lines.push(`Branch: ${state.branchHistory.join(' → ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatDynamicStep(step, state) {
  const lines = [];
  const prompt = buildStepPrompt(state);

  lines.push(`--- Step ${step.index + 1}: ${step.name} ---`);
  lines.push('');
  lines.push(prompt);
  lines.push('');

  // Show branch options if available
  const tmpl = TEMPLATES[state.template];
  if (tmpl.branches && step.index === state.currentStepIndex) {
    const branchKeys = Object.keys(tmpl.branches);
    if (branchKeys.length > 0) {
      lines.push('Branches:');
      for (const [key, branch] of Object.entries(tmpl.branches)) {
        lines.push(`  ${key} → ${branch.label}: ${branch.description}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatDynamicSummary(state) {
  const lines = [];
  const tmpl = TEMPLATES[state.template];

  lines.push(`[${tmpl.name} Complete] ${state.topic}`);
  lines.push('');

  for (const step of state.steps) {
    const mark = step.result ? '✓' : '○';
    lines.push(`${mark} Step ${step.index + 1}: ${step.name}`);
    if (step.result) {
      // Indent multi-line results
      const resultLines = step.result.split('\n');
      for (const rl of resultLines) {
        lines.push(`    ${rl}`);
      }
    }
    if (step.branchTaken) {
      lines.push(`    → Branch: ${step.branchTaken}`);
    }
    lines.push('');
  }

  if (state.branchHistory.length > 0) {
    lines.push(`Branch path: ${state.branchHistory.join(' → ')}`);
    lines.push('');
  }

  const completed = state.steps.filter(s => s.completed).length;
  lines.push(`Summary: ${completed}/${state.steps.length} steps completed`);
  if (state.cancelled) {
    lines.push('Session was cancelled.');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Branch resolution
// ---------------------------------------------------------------------------

/**
 * Apply a branch to the state. Branches can:
 * - Skip forward to a specific step (skipToStep)
 * - Insert extra steps (extraSteps)
 * - Replace remaining steps entirely
 */
function applyBranch(state, branchName) {
  const tmpl = TEMPLATES[state.template];
  if (!tmpl.branches || !tmpl.branches[branchName]) {
    console.error(`Unknown branch '${branchName}' for template '${state.template}'.`);
    console.error(`Available branches: ${Object.keys(tmpl.branches || {}).join(', ')}`);
    process.exit(1);
  }

  const branch = tmpl.branches[branchName];
  const currentIdx = state.currentStepIndex;

  // Mark current step's branch
  if (state.steps[currentIdx]) {
    state.steps[currentIdx].branchTaken = branchName;
  }
  state.branchHistory.push(branchName);

  if (branch.skipToStep !== undefined) {
    // Skip forward
    const targetIdx = Math.min(branch.skipToStep, state.totalSteps - 1);
    // Mark skipped steps as completed (no result)
    for (let i = currentIdx + 1; i < targetIdx; i++) {
      if (!state.steps[i]) continue;
      state.steps[i].completed = true;
      state.steps[i].result = '[Skipped per branch: ' + branchName + ']';
    }
    state.currentStepIndex = targetIdx;
    state.branchActive = true;
    state.branchParentStep = currentIdx;
  }

  if (branch.extraSteps) {
    // Insert extra steps after current position
    const extra = branch.extraSteps.map((s, i) => ({
      index: state.steps.length,
      name: s.name,
      prompt: s.prompt,
      result: null,
      completed: false,
      branchTaken: null,
      isExtra: true,
      branchOrigin: branchName,
    }));
    state.steps.splice(currentIdx + 1, 0, ...extra);
    state.totalSteps = state.steps.length;
    // Re-index
    state.steps.forEach((s, i) => { s.index = i; });
    // Move to the first extra step (or stay if current step not yet done)
    if (state.steps[currentIdx].completed) {
      state.currentStepIndex = currentIdx + 1;
    }
    state.branchActive = true;
    state.branchParentStep = currentIdx;
  }

  if (branch.replaceSteps !== undefined) {
    // Replace remaining steps entirely
    const replacementSteps = branch.replaceSteps.map((s, i) => ({
      index: currentIdx + 1 + i,
      name: s.name,
      prompt: s.prompt,
      result: null,
      completed: false,
      branchTaken: null,
      isExtra: true,
      branchOrigin: branchName,
    }));
    state.steps = state.steps.slice(0, currentIdx + 1).concat(replacementSteps);
    state.totalSteps = state.steps.length;
    state.steps.forEach((s, i) => { s.index = i; });
    if (state.steps[currentIdx].completed) {
      state.currentStepIndex = currentIdx + 1;
    }
    state.branchActive = true;
    state.branchParentStep = currentIdx;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Formatting (existing)
// ---------------------------------------------------------------------------

function formatText(template, topic, steps, opts) {
  const lines = [];

  lines.push(`[${template.name}] ${topic}`);
  lines.push(template.description);
  lines.push('');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    lines.push(`Step ${i + 1}/${steps.length}: ${step.name}`);
    lines.push(`  ${topic ? `Context: ${topic}` : ''}`);
    lines.push(`  ${step.prompt}`);
    if (step.notes) {
      lines.push(`  Note: ${step.notes}`);
    }
    if (step.planStep) {
      lines.push(`  Plan: ${JSON.stringify(step.planStep)}`);
    }
    lines.push('');
  }

  lines.push(`End of ${template.name}. Use smart_think to continue reasoning.`);

  return lines.join('\n');
}

function formatMarkdown(template, topic, steps, opts) {
  const lines = [];

  lines.push(`# ${template.name}: ${topic}`);
  lines.push(`> ${template.description}`);
  lines.push('');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    lines.push(`## Step ${i + 1}/${steps.length}: ${step.name}`);
    lines.push('');
    lines.push(`${step.prompt}`);
    if (step.notes) {
      lines.push('');
      lines.push(`> **Note:** ${step.notes}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`_End of ${template.name}. Continue with smart_think for deeper reasoning._`);

  return lines.join('\n');
}

function formatJSON(template, topic, steps, opts) {
  return JSON.stringify({
    template: template.name,
    description: template.description,
    topic,
    steps,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Plan Integration — merge planner output into thinking steps
// ---------------------------------------------------------------------------

function enrichStepsWithPlan(steps, opts) {
  const plan = opts.plan;
  if (!plan.steps || !Array.isArray(plan.steps)) return steps;

  const planSteps = plan.steps;
  const focusedIndex = opts.planStepIndex >= 0 ? opts.planStepIndex : -1;

  return steps.map((step, i) => {
    const planStep = focusedIndex >= 0 && focusedIndex < planSteps.length
      ? planSteps[focusedIndex]
      : i < planSteps.length ? planSteps[i] : null;

    if (planStep) {
      return {
        ...step,
        prompt: `${step.prompt}\n\nPlan Context [step ${planStep.id || (focusedIndex >= 0 ? focusedIndex + 1 : i + 1)}]: ${planStep.description || planStep.goal || planStep.task || '(no description)'}${planStep.tool ? `\nTool: ${planStep.tool}` : ''}${planStep.dependsOn ? `\nDepends on: ${Array.isArray(planStep.dependsOn) ? planStep.dependsOn.join(', ') : planStep.dependsOn}` : ''}`,
        planStep,
      };
    }
    return step;
  });
}

// ---------------------------------------------------------------------------
// Iterative Mode — output one step at a time, wait for user between steps
// ---------------------------------------------------------------------------

async function runIterative(template, topic, steps, opts) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n=== ${template.name} (Iterative Mode) ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Total steps: ${steps.length}\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`\n--- Step ${i + 1}: ${step.name} ---`);
    console.log(step.prompt);
    if (step.planStep) {
      console.log(`\nPlan Step: ${JSON.stringify(step.planStep, null, 2)}`);
    }
    console.log('');
    await new Promise(resolve => {
      rl.question('Press Enter for next step (or type feedback)... ', (answer) => {
        if (answer.trim()) {
          console.log(`\nNote: ${answer.trim()}`);
        }
        resolve();
      });
    });
  }

  console.log('\n=== Thinking Complete ===');
  rl.close();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const opts = {
    template: 'analyze',
    steps: 5,
    format: 'text',
    iterative: false,
    dynamic: false,
    plan: null,
    planStepIndex: -1,
    customSteps: [],
    // Dynamic mode state
    state: null,
    record: null,       // { index, result }
    advance: false,
    finish: false,
    status: false,
    branch: null,
    restore: null,
    resume: null,
    cancel: false,
  };

  const topicParts = [];
  let i = 0;

  while (i < args.length) {
    switch (args[i]) {
      case '--template':
      case '-t':
        opts.template = args[++i] || 'analyze';
        if (!TEMPLATES[opts.template]) {
          console.error(`Unknown template: ${opts.template}`);
          console.error(`Available templates: ${Object.keys(TEMPLATES).join(', ')}`);
          process.exit(1);
        }
        break;
      case '--steps':
      case '-s':
        opts.steps = parseInt(args[++i], 10) || 5;
        break;
      case '--format':
      case '-f':
        opts.format = args[++i];
        break;
      case '--iterative':
      case '-i':
        opts.iterative = true;
        break;
      case '--dynamic':
      case '-d':
        opts.dynamic = true;
        break;
      case '--plan':
        try {
          const planPath = args[++i];
          let raw;
          if (planPath.endsWith('.json')) {
            raw = readFileSync(planPath, 'utf8');
          } else {
            raw = planPath;
          }
          opts.plan = JSON.parse(raw);
        } catch (e) {
          console.error(`Error reading plan: ${e.message}`);
          process.exit(1);
        }
        break;
      case '--plan-step':
        opts.planStepIndex = parseInt(args[++i], 10) - 1;
        break;
      case '--state':
        opts.state = args[++i];
        break;
      case '--record':
        {
          const next = args[++i];
          // Support both formats:
          //   --record "idx:result" (from MCP plugin)
          //   --record idx "result" (direct CLI)
          // Index is 1-indexed in user input, convert to 0-indexed internally
          const colonIdx = next.indexOf(':');
          if (colonIdx > 0 && !isNaN(parseInt(next.slice(0, colonIdx), 10))) {
            const idx = parseInt(next.slice(0, colonIdx), 10) - 1;
            const result = next.slice(colonIdx + 1);
            opts.record = { index: idx, result };
          } else {
            opts.record = { index: parseInt(next, 10) - 1, result: args[++i] || '' };
          }
          if (opts.record.index < 0) opts.record.index = 0;
        }
        break;
      case '--advance':
        opts.advance = true;
        break;
      case '--finish':
        opts.finish = true;
        break;
      case '--status':
        opts.status = true;
        break;
      case '--branch':
        opts.branch = args[++i];
        break;
      case '--restore':
        opts.restore = args[++i];
        break;
      case '--cancel':
        opts.cancel = true;
        break;
      case '--resume':
        opts.resume = args[++i] || true;
        break;
      case '--no-color':
        // no-op
        break;
      default:
        if (!args[i].startsWith('--')) {
          topicParts.push(args[i]);
        }
        break;
    }
    i++;
  }

  opts.topic = topicParts.join(' ');

  // If plan mode, topic is deduced from the plan
  if (opts.plan) {
    opts.topic = opts.topic || opts.plan.goal || opts.plan.title || 'Plan execution';
  }

  return opts;
}

function printHelp() {
  console.log(`
Usage: node thinking.mjs <topic> [options]
       node thinking.mjs --template <name> <topic> [options]
       node thinking.mjs --plan <file.json | json-string> [--plan-step N] [options]
       node thinking.mjs --dynamic "topic" [--template <name>] [--state <path>]
       node thinking.mjs --state <path> --record <stepIdx> <result>
       node thinking.mjs --state <path> --advance
       node thinking.mjs --state <path> --branch <name>
       node thinking.mjs --state <path> --finish
       node thinking.mjs --state <path> --status
       node thinking.mjs --restore <path>

Structured Reasoning & Problem Analysis Tool  (v3.1 — Dynamic Multi-Step)

Templates:
  debug           Debug analysis: error → root cause → fix → verify
  refactor        Refactoring plan: deps → naming → safety → changes
  feature         Feature design: requirements → arch → impl → verify
  research        Research plan: search → analyze → compare → conclude
  decision        Decision analysis: options → pros/cons → recommendation
  analyze         General analysis: context → breakdown → insights
  plan_execute    Plan & execute: review plan → execute step → verify → next
  retrospect      Self-reflection: goal → process → learnings → actions
  architecture    Architecture decision: constraints → trade-offs → decision

Standard Options:
  --template <name>    Thinking template (default: analyze)
  --steps <n>          Number of thinking steps (default: 5)
  --format <fmt>       Output: text, json, markdown (default: text)
  --iterative, -i      Interactive mode: one step at a time with prompts
  --plan <file|json>   Load planner plan output for execution context
  --plan-step <N>      Focus on specific plan step (default: auto-detect)
  --no-color           Disable color output

Dynamic Multi-Step Options (state-based):
  --dynamic, -d        Start dynamic reasoning session
  --state <path>       State file path (default: ~/.smart/thinking-state.json)
  --record <N> <str>   Record result for step N and update accumulated context
  --advance            Advance to next thinking step
  --branch <name>      Select a branch path (see available branches in step output)
  --finish             Mark thinking session as complete, show summary
  --status             Show current thinking state without advancing
  --cancel             Cancel the thinking session
  --restore <path>     Load and display saved state (shorthand for --status)

Examples:
  node thinking.mjs "Why is my API returning 500 errors?"
  node thinking.mjs --template debug "TypeError in parser" --format markdown
  node thinking.mjs --dynamic "Should we use Prisma or Drizzle?" --template decision
  node thinking.mjs --state /tmp/thinking.json --record 3 "Prisma wins on DX"
  node thinking.mjs --state /tmp/thinking.json --advance
  node thinking.mjs --state /tmp/thinking.json --branch needs-deeper
  node thinking.mjs --state /tmp/thinking.json --finish
  node thinking.mjs --restore /tmp/thinking.json
  node thinking.mjs --template architecture "Design auth system" --format markdown
`);
}

async function main() {
  const opts = parseArgs();
  const statePath = opts.state || resolve(getDefaultStateDir(), 'thinking-state.json');
  _statePath = statePath;

  // ======================================================================
  // Dynamic mode sub-commands
  // ======================================================================

  // --restore: load and show state
  if (opts.restore) {
    const state = readState(opts.restore);
    _statePath = opts.restore;
    console.log(formatDynamicHeader(state, getCurrentStep(state)));
    const currentStep = getCurrentStep(state);
    if (currentStep && !state.completed) {
      console.log(formatDynamicStep(currentStep, state));
    } else {
      console.log(formatDynamicSummary(state));
    }
    process.exit(0);
  }

  // --cancel: cancel the thinking session
  if (opts.cancel && statePath && existsSync(statePath)) {
    const state = readState(statePath);
    state.cancelled = true;
    state.completed = true;
    writeState(statePath, state);
    console.log('Thinking session cancelled.');
    process.exit(0);
  }

  // --record: record a step result
  if (opts.record && statePath && existsSync(statePath)) {
    const state = readState(statePath);
    const { index, result } = opts.record;
    if (index < 0 || index >= state.steps.length) {
      console.error(`Invalid step index: ${index}. Steps: 0-${state.steps.length - 1}`);
      process.exit(1);
    }
    state.steps[index].result = result;
    state.steps[index].completed = true;
    updateAccumulatedContext(state);
    writeState(statePath, state);
    console.log(`✅ Recorded result for step ${index + 1} (${state.steps[index].name})`);

    // If --advance also set, auto-advance to next incomplete step
    if (opts.advance) {
      // Advance currentStepIndex past the just-recorded step
      if (state.currentStepIndex <= index) {
        state.currentStepIndex = index + 1;
      }
      // Skip any already-completed steps
      while (state.currentStepIndex < state.steps.length) {
        if (!state.steps[state.currentStepIndex].completed) break;
        state.currentStepIndex++;
      }
      writeState(statePath, state);
      const nextStep = getCurrentStep(state);
      if (!nextStep) {
        console.log('\nAll steps completed. Use --finish for summary.');
        console.log(formatDynamicSummary(state));
      } else {
        console.log(`\nNow at step ${state.currentStepIndex + 1}: ${nextStep.name}\n`);
        console.log(formatDynamicHeader(state, nextStep));
        console.log(formatDynamicStep(nextStep, state));
      }
    }
    // If --finish or --status also set, fall through
    if (!opts.finish && !opts.status) process.exit(0);
  }

  // --advance alone: advance to next step
  if (opts.advance && statePath && existsSync(statePath) && !opts.record) {
    const state = readState(statePath);
    // Mark current step as completed if not already
    const current = getCurrentStep(state);
    if (current && !current.completed) {
      current.completed = true;
      current.result = current.result || '[No result recorded, marked complete]';
      updateAccumulatedContext(state);
    }
    // Move to next incomplete step
    while (state.currentStepIndex < state.steps.length) {
      state.currentStepIndex++;
      if (state.currentStepIndex >= state.steps.length) break;
      if (!state.steps[state.currentStepIndex].completed) break;
    }
    writeState(statePath, state);

    const nextStep = getCurrentStep(state);
    if (!nextStep) {
      console.log('All steps completed. Use --finish for summary.');
      console.log(formatDynamicSummary(state));
    } else {
      console.log(formatDynamicHeader(state, nextStep));
      console.log(formatDynamicStep(nextStep, state));
    }
    process.exit(0);
  }

  // --branch: select a branch path
  if (opts.branch && statePath && existsSync(statePath)) {
    const state = readState(statePath);
    applyBranch(state, opts.branch);
    writeState(statePath, state);
    const currentStep = getCurrentStep(state);
    console.log(`Branch selected: ${opts.branch}`);
    if (currentStep) {
      console.log('\n' + formatDynamicHeader(state, currentStep));
      console.log(formatDynamicStep(currentStep, state));
    } else {
      console.log('\nAll steps completed in this branch.');
      console.log(formatDynamicSummary(state));
    }
    process.exit(0);
  }

  // --finish: mark complete, show summary
  if (opts.finish && statePath && existsSync(statePath)) {
    const state = readState(statePath);
    // Mark any incomplete steps
    for (const step of state.steps) {
      if (!step.completed) {
        step.completed = true;
        step.result = step.result || '[Skipped — session ended]';
      }
    }
    state.completed = true;
    state.currentStepIndex = state.steps.length;
    updateAccumulatedContext(state);
    writeState(statePath, state);
    console.log(formatDynamicSummary(state));
    process.exit(0);
  }

  // --status: show current state without advancing (read-only, after all mutations)
  if (opts.status && statePath && existsSync(statePath)) {
    const state = readState(statePath);
    _statePath = statePath;
    console.log(formatDynamicHeader(state, getCurrentStep(state)));
    const currentStep = getCurrentStep(state);
    if (currentStep && !state.completed) {
      console.log(formatDynamicStep(currentStep, state));
    } else if (state.completed) {
      console.log(formatDynamicSummary(state));
    } else {
      console.log('All steps completed. Use --finish for summary.');
    }
    process.exit(0);
  }

  // --dynamic: start new dynamic reasoning session
  if (opts.dynamic) {
    if (!opts.topic) {
      console.error('Error: --dynamic requires a topic. Usage: thinking.mjs --dynamic "Your question" [--template name]');
      process.exit(1);
    }
    const state = createState(statePath, opts.template, opts.topic);

    // Inject plan context if provided
    if (opts.plan) {
      const enrichedSteps = enrichStepsWithPlan(state.steps, opts);
      state.steps = enrichedSteps;
      state.totalSteps = enrichedSteps.length;
    }

    writeState(statePath, state);

    const firstStep = getCurrentStep(state);
    console.log(formatDynamicHeader(state, firstStep));
    console.log(formatDynamicStep(firstStep, state));
    return;
  }

  // ======================================================================
  // Static mode (existing behavior)
  // ======================================================================

  const template = TEMPLATES[opts.template];

  // If --plan is supplied, merge plan context into steps
  let steps = template.steps.slice(0, opts.steps);
  if (opts.plan) {
    steps = enrichStepsWithPlan(steps, opts);
  }

  // Iterative mode: output one step at a time and wait for user input
  if (opts.iterative) {
    await runIterative(template, opts.topic, steps, opts);
    return;
  }

  // Standard validation for static mode: need topic
  if (!opts.topic) {
    console.error('Error: A topic or question is required. Use --dynamic for state-based sessions.');
    process.exit(1);
  }

  let output;
  switch (opts.format) {
    case 'json':
      output = formatJSON(template, opts.topic, steps, opts);
      break;
    case 'markdown':
      output = formatMarkdown(template, opts.topic, steps, opts);
      break;
    case 'text':
    default:
      output = formatText(template, opts.topic, steps, opts);
      break;
  }

  console.log(output);
}

// Only run CLI when executed directly (not when imported)
// Alias for plan compatibility
export const quickThink = quickThought;

const isMainModule = process.argv[1] && (
  process.argv[1] === resolve(process.cwd(), 'thinking.mjs') ||
  process.argv[1].endsWith('/thinking.mjs')
);
if (isMainModule) {
  main().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
