// academic-review.mjs → smart_academic_review
// Phase 15.1: Academic peer review plugin based on Remi 10-point framework.
// Integrated from Deep Research Agent (CYC2002tommy/deep-research-agent, MIT).
//
// Usage:
//   smart_academic_review({ text: "...", format: "markdown" })
//   smart_academic_review({ text: "...", section: "methods" })

const REVIEW_FRAMEWORK = {
  name: 'Remi',
  level: 'Nature/Science',
  points: [
    {
      id: 1,
      name: 'Scientific quality and novelty',
      question: 'Is the research question important and clearly defined? Is the contribution novel or incremental? Does it advance the field meaningfully?',
      weight: 'critical',
    },
    {
      id: 2,
      name: 'Methodology and assumptions',
      question: 'Are the methods appropriate and well-justified? Identify any hidden assumptions or unrealistic simplifications. Are there methodological gaps, missing controls, or biases? Is the data sufficient and reliable?',
      weight: 'critical',
    },
    {
      id: 3,
      name: 'Consistency and coherence',
      question: 'Identify inconsistencies between sections (abstract, methods, results, conclusions). Check logical flow and internal contradictions.',
      weight: 'major',
    },
    {
      id: 4,
      name: 'Results and interpretation',
      question: 'Are results correctly interpreted or overstated? Are claims supported by data? Any overfitting, selective reporting, or exaggeration?',
      weight: 'critical',
    },
    {
      id: 5,
      name: 'Figures, tables, and presentation',
      question: 'Are figures clear, informative, and publication-ready? Do tables communicate effectively or need redesign? Any misleading visualization choices?',
      weight: 'major',
    },
    {
      id: 6,
      name: 'Literature review',
      question: 'Is the literature up to date and well-balanced? Are key references missing? Is the positioning of the work strong enough?',
      weight: 'major',
    },
    {
      id: 7,
      name: 'Impact and relevance',
      question: 'Who benefits from this work (scientifically and practically)? Is the impact overstated or well justified?',
      weight: 'minor',
    },
    {
      id: 8,
      name: 'Meta-commentary & Tone',
      question: 'Strip out all "meta-commentary", assignment-like narratives (e.g., "In Step 1 we...", "we applied the formulas"), and self-referential writing processes. Reframe into strict, objective academic methodology and limitations. Flag "student-like" language.',
      weight: 'major',
    },
    {
      id: 9,
      name: 'Major and minor issues',
      question: 'List major concerns that must be fixed before publication. List minor issues (clarity, grammar, formatting). The manuscript must read as an objective, confident academic paper.',
      weight: 'critical',
    },
    {
      id: 10,
      name: 'Final recommendation',
      question: 'Accept / Minor revision / Major revision / Reject. Justify clearly and objectively.',
      weight: 'critical',
    },
  ],
  redLines: [
    'Do not hallucinate citations — only reference what is in the provided text.',
    'Do not replace the author\'s critical thinking — you are a support tool.',
    'Never ask for or output a full manuscript at once if it risks context limits.',
  ],
  bannedVocabulary: [
    'delve', 'tapestry', 'in conclusion', 'crucial', 'testament',
    'realm', 'fosters', 'underscores', 'moreover', 'notably',
    'it is worth noting', 'interestingly', 'furthermore',
  ],
};

/**
 * Build the review prompt from the framework.
 */
function buildReviewPrompt(text, section) {
  const scope = section
    ? `Focus your review on the **${section}** section only.`
    : 'Review the entire manuscript.';

  let prompt = `# Remi: Academic Manuscript Reviewer\n\n`;
  prompt += `You are "Remi", a peer reviewer for high-impact scientific journals (Nature, Science, Environmental Science & Technology). Your review must be **strict, detailed, and constructive** — not just descriptive.\n\n`;
  prompt += `## Core Red Lines\n`;
  for (const line of REVIEW_FRAMEWORK.redLines) {
    prompt += `- ${line}\n`;
  }
  prompt += `\n## Scope\n${scope}\n\n`;
  prompt += `## Banned AI Vocabulary\n`;
  prompt += `Flag any use of: ${REVIEW_FRAMEWORK.bannedVocabulary.join(', ')}\n\n`;
  prompt += `## 10-Point Review\n\n`;
  prompt += `For each point below, provide:\n`;
  prompt += `- **Assessment**: Your evaluation\n`;
  prompt += `- **Evidence**: Specific examples from the text\n`;
  prompt += `- **Severity**: critical | major | minor\n`;
  prompt += `- **Recommendation**: What to fix\n\n`;

  for (const point of REVIEW_FRAMEWORK.points) {
    prompt += `### ${point.id}. ${point.name} [${point.weight}]\n`;
    prompt += `${point.question}\n\n`;
  }

  prompt += `---\n`;
  prompt += `## Manuscript to Review\n\n`;
  prompt += text;

  return prompt;
}

/**
 * Build a structured review template (for LLM to fill in).
 */
function buildReviewTemplate(text, section) {
  const scope = section
    ? `Focus: ${section} section only`
    : 'Focus: entire manuscript';

  let output = `# Remi Peer Review Report\n\n`;
  output += `**Review Level**: ${REVIEW_FRAMEWORK.level}\n`;
  output += `**Scope**: ${scope}\n`;
  output += `**Text Length**: ${text.length} chars\n\n`;
  output += `---\n\n`;
  output += `## Executive Summary\n\n`;
  output += `[Provide a 2-3 sentence summary of the overall assessment]\n\n`;
  output += `---\n\n`;
  output += `## 10-Point Detailed Review\n\n`;

  for (const point of REVIEW_FRAMEWORK.points) {
    output += `### ${point.id}. ${point.name} [${point.weight}]\n\n`;
    output += `**Assessment**: [Your evaluation here]\n\n`;
    output += `**Evidence**: [Specific examples from text]\n\n`;
    output += `**Severity**: [critical | major | minor]\n\n`;
    output += `**Recommendation**: [What to fix]\n\n`;
    output += `---\n\n`;
  }

  output += `## Banned Vocabulary Check\n\n`;
  output += `| Word/Phrase | Found? | Location |\n`;
  output += `|-------------|--------|----------|\n`;
  for (const word of REVIEW_FRAMEWORK.bannedVocabulary) {
    output += `| ${word} | | |\n`;
  }
  output += `\n---\n\n`;
  output += `## Final Recommendation\n\n`;
  output += `**Verdict**: [Accept | Minor Revision | Major Revision | Reject]\n\n`;
  output += `**Justification**: [Clear, objective reasoning]\n\n`;
  output += `---\n\n`;
  output += `## Manuscript Text\n\n`;
  output += `<details>\n<summary>Click to expand</summary>\n\n${text}\n\n</details>\n`;

  return output;
}

export default {
  name: 'smart_academic_review',
  category: 'standard',
  description: `Academic peer review using the Remi 10-point framework (Nature/Science level).

Evaluates manuscripts across 10 dimensions:
  1. Scientific quality and novelty
  2. Methodology and assumptions
  3. Consistency and coherence
  4. Results and interpretation
  5. Figures, tables, and presentation
  6. Literature review
  7. Impact and relevance
  8. Meta-commentary & Tone (AI fluff detection)
  9. Major and minor issues
  10. Final recommendation (Accept/Minor/Major/Reject)

Also checks for banned AI vocabulary: delve, tapestry, crucial, testament, realm, fosters, underscores, moreover.

Modes:
  - mode:"prompt" → Returns the review prompt for LLM to execute (default)
  - mode:"template" → Returns a structured fill-in template
  - mode:"framework" → Returns just the 10-point framework definition

Examples:
  { text: "Full manuscript text...", mode: "prompt" }
  { text: "Methods section...", section: "methods", mode: "template" }`,

  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The manuscript text to review (required)',
      },
      mode: {
        type: 'string',
        enum: ['prompt', 'template', 'framework'],
        description: 'Output mode: prompt (review prompt for LLM), template (structured fill-in), framework (definition only). Default: prompt.',
      },
      section: {
        type: 'string',
        description: 'Focus review on a specific section (e.g., "methods", "results", "introduction")',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'markdown'],
        description: 'Output format (default: markdown)',
      },
    },
    required: ['text'],
  },

  handler: async (args) => {
    const { text, mode = 'prompt', section, format = 'markdown' } = args;

    if (!text || !text.trim()) {
      return 'Error: text is required. Provide the manuscript text to review.';
    }

    if (mode === 'framework') {
      if (format === 'json') {
        return JSON.stringify(REVIEW_FRAMEWORK, null, 2);
      }
      let out = '# Remi 10-Point Review Framework\n\n';
      out += `**Level**: ${REVIEW_FRAMEWORK.level}\n\n`;
      out += `## Red Lines\n`;
      for (const line of REVIEW_FRAMEWORK.redLines) {
        out += `- ${line}\n`;
      }
      out += `\n## Banned Vocabulary\n${REVIEW_FRAMEWORK.bannedVocabulary.join(', ')}\n\n`;
      out += `## Review Points\n\n`;
      out += `| # | Dimension | Weight | Key Question |\n`;
      out += `|---|-----------|--------|-------------|\n`;
      for (const p of REVIEW_FRAMEWORK.points) {
        out += `| ${p.id} | ${p.name} | ${p.weight} | ${p.question.substring(0, 80)}... |\n`;
      }
      return out;
    }

    if (mode === 'template') {
      const template = buildReviewTemplate(text, section);
      return template;
    }

    // Default: prompt mode
    const prompt = buildReviewPrompt(text, section);
    return prompt;
  },
};