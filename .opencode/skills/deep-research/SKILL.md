---
name: deep-research
description: "End-to-end scientific research pipeline — literature search, full-text deep reading, anti-hallucination verification, peer review, and DOCX compilation. Adapted from Deep Research Agent (CYC2002tommy/deep-research-agent, MIT) for Smart MCP."
triggers:
  - "write a scientific article"
  - "literature review"
  - "deep research on"
  - "academic paper about"
  - "peer review this"
  - "generate a research report"
  - "/deep-research"
---

# Deep Research (Smart MCP Edition)

End-to-end scientific research pipeline combining Smart MCP's academic search, document ingestion, hallucination detection, peer review, and DOCX generation into one cohesive workflow.

## 🎯 Trigger Conditions

- User asks to write a scientific article, literature review, or deep-dive research report.
- User requests comprehensive research using academic databases.
- The output requires rigorous academic citations (APA 7th) with verified references.

## 📋 7-Phase Pipeline

### Phase 0: Research Plan & Approval

1. Formulate a preliminary research plan:
   - Proposed keywords and search queries
   - Target databases (OpenAlex, Crossref, Semantic Scholar)
   - Expected article structure and goals
2. Present this blueprint to the user for discussion.
3. **Halt & Wait**: You MUST wait for the user's explicit approval before proceeding to Phase 1.

**Smart MCP tools**: `smart_deep_think({ template: "research" })` for planning.

---

### Phase 1: Academic Discovery

Search across multiple academic databases. Process the exhaustive set of relevant findings.

1. **Multi-source search**: Run parallel searches across:
   - `smart_academic_search({ source: "openalex", query: "...", yearFrom: 2015 })`
   - `smart_academic_search({ source: "crossref", query: "..." })`
   - `smart_academic_search({ source: "semantic_scholar", query: "..." })`

2. **Journal Quality Filter**: ONLY include Q1 and Q2 papers. If a Q3 paper provides crucial evidence, explicitly mark it with `[Q3]`. STRICTLY EXCLUDE Q4 papers and MDPI publications (OpenAlex search auto-filters MDPI).

3. **Structured Literature Table**: Build a markdown table:
   ```
   | # | Title | Authors/Year | Journal | Key Finding | DOI | OA? |
   |---|-------|-------------|---------|-------------|-----|-----|
   ```

4. **Intersection of Zero Rule**: When cross-analyzing highly specific variables, NEVER combine them into a single search query. Deconstruct into atomic, independent searches and synthesize post-retrieval.

---

### Phase 2: Full-Text Deep Reading

**CRITICAL**: You MUST NOT rely solely on abstracts. Download and read the full text of filtered papers.

1. **OA Availability Check**: For each selected paper:
   - `smart_academic_search({ source: "unpaywall", doi: "..." })` — find OA PDF URLs

2. **Full-Text Ingestion**: For papers with OA PDFs:
   - `smart_ingest_document({ path: "/path/to/downloaded.pdf" })` — convert to readable markdown
   - Read Methodology and Results sections specifically

3. **Deep Reading & Filtering**: Extract actual mechanisms from full texts. Discard papers that fail to substantiate abstract claims or overstate findings.

4. **Synthesis**: Cross-reference extracted findings across multiple sources to validate claims and identify consensus vs. controversy.

**Smart MCP tools**: `smart_academic_search({ source: "unpaywall" })` → `smart_ingest_document()` → `smart_deep_think({ template: "research" })`

---

### Phase 3: Structural Drafting

1. Outline the article: strong hook → logical progression → evidence-backed claims → clear headings.
2. Integrate data explicitly. Use Mermaid diagrams for complex systems or workflows.
3. Format all inline citations and reference list strictly in **APA 7th** format.
4. Every claim MUST map to a real DOI found during Phase 1/2.

**Smart MCP tools**: `smart_deep_think({ template: "architecture" })` for structure, `smart_think()` for drafting.

---

### Phase 4: Anti-Hallucination & Verification

**Strict Requirement**: This phase MUST be completed before peer review (Phase 5).

1. **DOI Liveness Test**: Run DOI verification on the complete draft:
   - `smart_hallucination_check({ output: "<full draft>", mode: "doi" })`
   - If any DOI is dead (404): **Delete the citation and rewrite the affected claim**, or find the correct live DOI.

2. **Claim Grounding Check**: Cross-reference specific claims against raw data/abstracts from Phases 1 & 2.
   - **Strict Literalism**: Never over-extend findings.
   - **No Concept Stitching**: Do not stitch a macro finding with a localized context unless the source explicitly connects them.

3. **Banned AI Vocabulary**: Strip all of: "delve", "tapestry", "in conclusion", "crucial", "testament", "realm", "fosters", "underscores", "moreover", "notably", "it is worth noting", "interestingly", "furthermore".

4. **Pass Condition**: Zero dead links, zero fake DOIs, zero ungrounded claims. Only then proceed to Phase 5.

**Smart MCP tools**: `smart_hallucination_check({ mode: "doi" })` + `smart_hallucination_check({ mode: "default" })`

---

### Phase 5: Peer Review (Remi)

1. Submit the Phase 4 draft for rigorous Nature/Science-level peer review:
   - `smart_academic_review({ text: "<draft>", mode: "prompt" })`
   - Or use: `smart_deep_think({ template: "peer_review", topic: "<draft>" })`

2. **Iteration Loop**: Analyze the review critique. If there are any flaws, fluff, or stylistic complaints, apply the fixes and rewrite the draft.

3. Repeat the review process until the manuscript passes with zero critical concerns.

**Smart MCP tools**: `smart_academic_review()` or `smart_deep_think({ template: "peer_review" })`

---

### Phase 6: Document Generation (.docx)

1. **Compile Final DOCX**: Use the docx-generate plugin to produce an APA 7th formatted Word document:
   - `smart_docx_generate({ title: "...", sections: [...], references: [...], outputPath: "..." })`

2. **Embed Visuals**: Include any Mermaid diagrams or data tables generated during Phase 3.

3. **APA 7th Formatting**: Hanging indents for references, proper heading hierarchy, italicized journal names and volume numbers.

**Smart MCP tools**: `smart_docx_generate()`

---

### Phase 7: Knowledge Base Integration (Optional)

1. **Save Research Summary**: Write key findings to your knowledge base for future reference.
2. **Archive References**: Store verified DOIs and abstracts for cross-session lookup.

**Smart MCP tools**: `smart_ingest_document()` for saving, `smart_search_docs()` for future retrieval.

---

## ⚠️ Strict Rules

- **STRICT COMPLIANCE REQUIRED**: Follow EVERY step of this pipeline in order. No skipping phases or taking shortcuts.
- **English Output ONLY**: All generated drafts, reports, and final documents MUST be in English.
- **FULL-TEXT READING IS MANDATORY**: Do NOT rely solely on abstracts. Download and read full text before synthesizing.
- **No Hallucinated Citations**: Every claim MUST map to a real, verified DOI.
- **MDPI Exclusion**: OpenAlex search auto-filters MDPI. Do not manually add MDPI papers.
- **API Rate Limits**: Respect rate limits. OpenAlex: ~10 req/s. Semantic Scholar: ~100 req/5min. Crossref: ~50 req/s.
- **Action Over Planning**: After Phase 0 approval, immediately start executing searches. Do not re-plan.

## 📚 Tool Reference

| Phase | Primary Tools |
|-------|--------------|
| 0 | `smart_deep_think({ template: "research" })` |
| 1 | `smart_academic_search({ source: "openalex"|"crossref"|"semantic_scholar" })` |
| 2 | `smart_academic_search({ source: "unpaywall" })` → `smart_ingest_document()` |
| 3 | `smart_deep_think({ template: "architecture" })` + `smart_think()` |
| 4 | `smart_hallucination_check({ mode: "doi" })` + `smart_hallucination_check()` |
| 5 | `smart_academic_review()` or `smart_deep_think({ template: "peer_review" })` |
| 6 | `smart_docx_generate()` |
| 7 | `smart_ingest_document()` + `smart_search_docs()` |