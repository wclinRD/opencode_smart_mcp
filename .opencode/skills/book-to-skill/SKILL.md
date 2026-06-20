---
name: book-to-skill
description: "Convert books and documents (PDF, EPUB, DOCX, HTML, Markdown, RTF, MOBI/AZW) into structured, on-demand agent skills — extracting frameworks, mental models, principles, and anti-patterns. Adapted from virgiliojr94/book-to-skill (MIT) for Smart MCP."
triggers:
  - "book-to-skill"
  - "convert book"
  - "turn this book into a skill"
  - "make a skill from"
  - "create a skill from this document"
  - "/book-to-skill"
  - "extract knowledge from this book"
  - "study this book with the agent"
  - "skill from this PDF"
---

# Book-to-Skill (Smart MCP Edition)

Turn any technical book, document folder, or collection of sources into a unified agent skill — ready to study, reference, and use while you work in OpenCode.

## 🎯 Trigger Conditions

- User provides document paths (PDF, EPUB, DOCX, etc.) and asks to convert them into a skill
- User says "book-to-skill", "make a skill from this book", or "convert this document"
- User wants to build a reusable knowledge base from a file they own

## 📦 What It Generates

Running the pipeline creates a full skill in `.opencode/skills/<slug>/` (or `~/.agents/skills/<slug>/`):

| File | Purpose | Size |
|------|---------|------|
| `SKILL.md` | Core mental models + chapter index | ~4,000 tokens |
| `chapters/ch01-*.md` … | One file per chapter, loaded on-demand | ~1,000 tokens each |
| `glossary.md` | Every key term, alphabetically sorted with chapter refs | ~1,500 tokens |
| `patterns.md` | All techniques, algorithms, and design patterns | ~2,000 tokens |
| `cheatsheet.md` | Decision tables and quick-reference rules | ~1,000 tokens |

**Chapter files are loaded on-demand** — they don't count against the skill budget until you ask about that topic.

---

## 📋 Pipeline

### Phase 0: Scope Check & Input Validation

1. Verify input paths exist and contain supported formats (`.pdf`, `.epub`, `.docx`, `.txt`, `.md`, `.markdown`, `.rst`, `.adoc`, `.html`, `.htm`, `.rtf`, `.mobi`, `.azw`, `.azw3`).
2. If the last argument is a valid slug (not a file/folder/glob) and `SKILL_NAME` is not otherwise specified, treat it as the skill name.
3. If targeting an existing skill directory (contains `SKILL.md` + `chapters/`), switch to **Update/Fold-in Mode** (Phase 9).
4. If no input paths provided, stop and show usage.

**Smart MCP tools**: `smart_smart_glob({pattern})` for glob expansion, `smart_smart_read({file})` for directory listing.

---

### Phase 1: Content Type Identification

Ask the user:

> "What kind of content do these sources have?
> 1. **Technical** — code blocks, tables, formulas (e.g. programming books, academic papers)
> 2. **Text-heavy** — mostly prose (e.g. management, productivity, narrative)
> 3. **Not sure** — I'll use the fast method"

Store as `BOOK_TYPE` (technical/text/text for option 3).

**Smart MCP tools**: `smart_smart_think({mode:"structured"})` for interactive choice.

---

### Phase 2: Text Extraction

Extract text from all source documents:

**For PDF/DOCX/TXT/MD/HTML (formats Smart MCP handles well):**
```
ssr({tool:"ingest_document", args:{path:"...", summary:"..."}})
```

**For EPUB/MOBI/RTF (formats needing Python extractors):**
```bash
python3 scripts/extract.py <paths...> --mode <technical|text> --install-missing yes
```

The script creates:
- `/tmp/book_skill_work/full_text.txt` — combined extracted text
- `/tmp/book_skill_work/metadata.json` — stats (size, tokens, pages, per-source details)

Read metadata.json to inspect results.

**Smart MCP tools**: `ssr({tool:"ingest_document"})` for supported formats, `bash` + Python extractor for EPUB/MOBI/RTF, `smart_smart_read` to inspect output.

---

### Phase 2.5: Cost Estimate

Present the user with an estimate before generating:

```
📖 Sources: <N> | Tokens: ~<N>K
💰 Estimated cost: ~$<X> (Sonnet)
➡  Proceed with conversion? (or "analyze only")
```

**Smart MCP tools**: `smart_smart_read` to read metadata.json, `smart_smart_think` for confirmation.

---

### Phase 3: REPL-Style Access (Books > 50k tokens)

For large books, use programmatic probes instead of loading full text:

```bash
# Size check
wc -w /tmp/book_skill_work/full_text.txt

# Find chapter offsets
grep -n -E "^\s*(Chapter|CHAPTER)\s+[0-9]+" /tmp/book_skill_work/full_text.txt | head -40

# Pull specific chapter
sed -n '<start>,<end>p' /tmp/book_skill_work/full_text.txt

# Verify frameworks exist
grep -c -i "westrum\|dora" /tmp/book_skill_work/full_text.txt
```

Under 50k tokens, a single read is fine.

---

### Phase 4: Structure Analysis

Read the first 8,000 characters of `full_text.txt` to identify:
- Book **title** and **author(s)**
- **Chapter structure** (look for "Chapter N", "PART I", numbered headings)
- **Core themes** and subject domain
- Approximate number of chapters

**Smart MCP tools**: `smart_smart_read({file:"full_text.txt", limit:200})`, `smart_smart_think({template:"analyze"})`

---

### Phase 5: Determine Skill Name & Location

If `SKILL_NAME` not provided, propose options:
- `{author-lastname}-{core-concept}` (e.g. `cialdini-influence`)
- Lowercase-hyphen from title (e.g. `designing-data-intensive-apps`)

Choose destination:

| Host | Skill Root |
|------|-----------|
| OpenCode / Smart MCP | `.opencode/skills/<slug>/` |
| Cross-agent | `~/.agents/skills/<slug>/` |
| Claude Code | `~/.claude/skills/<slug>/` |

Default to `.opencode/skills/<slug>/` for Smart MCP projects.

Create the directory:
```bash
SKILL_HOME=".opencode/skills/<slug>"
mkdir -p "$SKILL_HOME/chapters"
```

If the skill exists, ask: Update/fold-in (Phase 9), Overwrite, or Rename.

**Smart MCP tools**: `smart_smart_fast_apply({file:"...", content:"..."})` for file creation, `bash` for mkdir.

---

### Phase 6: Generate Chapter Summaries

For EACH chapter identified in Phase 4:

1. Read the corresponding section of `full_text.txt` (using grep/sed for offsets)
2. Generate a structured chapter file using the template below
3. Write to `chapters/ch<NN>-<slug>.md`

**Token budget by type:**

| | `DEPTH=reference` | `DEPTH=study` |
|---|---|---|
| `BOOK_TYPE=text` | 800–1,200 tokens | 1,000–1,800 tokens |
| `BOOK_TYPE=technical` | 1,200–1,800 tokens | 2,000–3,000 tokens |

**Chapter template:**
```markdown
# Chapter N: <Full Title>

## Core Idea
<1–2 sentences>

## Frameworks Introduced
- **<Framework Name>**: <exact formulation>
  - When to use: <specific situation>
  - How: <steps or criteria>

## Key Concepts
- **<Term>**: <definition> (Ch N)

## Mental Models
<Use X when Y, Think of X as Y>

## Anti-patterns
- **<What to avoid>**: <why it fails>

## Code Examples *(technical only)*

## Reference Tables *(technical only)*

## Worked Example *(study depth only)*

## Key Takeaways
1. <Actionable insight>

## Connects To
- **Ch N**: <relationship>
```

**Smart MCP tools**: `smart_smart_think({template:"analyze"})` for analysis, `smart_smart_fast_apply({file, content})` for writing files.

---

### Phase 7: Generate Supporting Files

**glossary.md** — All key terms, alphabetically sorted with chapter refs (~1,500 tokens)
**patterns.md** — Techniques, algorithms, design patterns (~2,000 tokens)
**cheatsheet.md** — Decision tables, quick-reference rules (~1,200 tokens)

The cheatsheet is the most differentiated layer — it captures the author's *judgment*, not keyword definitions:
- Decision rules ("When X, do Y, because Z")
- Decision trees / flowcharts
- Trade-off matrices
- Thresholds & defaults
- Tells & smells

**Smart MCP tools**: `smart_smart_fast_apply({file, content})`

---

### Phase 8: Generate Master SKILL.md

**CRITICAL**: Keep SKILL.md body under **4,000 tokens**. Compaction truncates from the end — put the most important content first.

```markdown
---
name: <slug>
description: "Knowledge base from \"<Title>\" by <Author>. Use when applying <author>'s frameworks for <topics>."
---

# <Title>
**Author**: <Author> | **Pages**: ~<N> | **Chapters**: <N> | **Generated**: <YYYY-MM-DD>

## How to Use This Skill
- **Without arguments** — load core frameworks
- **With a topic** — "replication", "pricing" → read relevant chapter
- **With chapter** — "ch05" → load that chapter
- **Browse** — "what chapters do you have?"

## Core Frameworks & Mental Models
<!-- ~2,000 tokens: most important named frameworks. Preserve exact names. -->

## Chapter Index
| # | Title | Key Frameworks |
|---|-------|----------------|

## Topic Index
- **Term** → ch<N>

## Supporting Files
- [glossary.md](glossary.md)
- [patterns.md](patterns.md)  
- [cheatsheet.md](cheatsheet.md)
```

**Smart MCP tools**: `smart_smart_fast_apply({file, content})`

---

### Phase 9: Update / Fold-in Workflow

When adding new content to an existing skill:

1. Read existing `SKILL.md`, `chapters/`, glossary/patterns/cheatsheet
2. Identify if new content revises existing chapters or adds new ones
3. For existing chapters: read, merge, rewrite
4. For new chapters: create `ch<max+1>-*.md` onward
5. Merge glossary alphabetically, add chapter refs to existing terms
6. Merge new patterns, cheatsheet entries
7. Update SKILL.md metadata + chapter index + topic index

**Smart MCP tools**: `smart_smart_read` to parse existing files, `smart_smart_fast_apply` for updates.

---

### Phase 10: Cleanup & Report

```bash
rm -rf /tmp/book_skill_work
```

Report to user:
```
✅ Skill created: .opencode/skills/<slug>/

📚 <Title> — <Author> | Chapters: <N>

Files generated:
  SKILL.md          — core frameworks + index   (~X tokens)
  chapters/         — <N> summaries             (~X each)
  glossary.md       — key terms                 (~X tokens)
  patterns.md       — techniques & patterns     (~X tokens)
  cheatsheet.md     — quick reference           (~X tokens)

Usage:
  skill("<slug>")                     → load core frameworks
  skill("<slug>") + ask <topic>       → find and explain a topic
  skill("<slug>") + ask ch<N>         → dive into a specific chapter
```

---

## ⚠️ Quality Rules

1. **Extract structure, not summaries** — capture named frameworks, exact formulations, anti-patterns
2. **Preserve the author's precision** — "The 5 Whys" ≠ "ask why multiple times"
3. **Density over completeness** — 1,000-token summary beats 10,000-token excerpt
4. **Practitioner voice** — "Use X when Y", not "The book explains X"
5. **Front-load SKILL.md** — compaction keeps the first ~5,000 tokens
6. **Chapter files are on-demand** — they don't count against skill budget until loaded
7. **Never copy raw book text** — always synthesize, summarize, extract signal
8. **Topic index is critical** — it's how the agent navigates to the right chapter
9. **Use Smart MCP tools** — `smart_ingest_document` for PDF/DOCX/TXT, Python extractor for EPUB/MOBI/RTF, `smart_fast_apply` for all file writes

## 🛠 Tool Reference

| Phase | Smart MCP Tools |
|-------|----------------|
| 0 | `smart_glob`, `smart_read`, `ingest_document` (via ssr) |
| 1 | `smart_think({mode:"structured"})` |
| 2 | `ssr({tool:"ingest_document"})`, `bash` + Python extractor |
| 2.5 | `smart_read`, `smart_think` |
| 3 | `bash` (grep/sed/wc), `smart_read` |
| 4 | `smart_read`, `smart_think({template:"analyze"})` |
| 5 | `bash` (mkdir), `smart_fast_apply` |
| 6 | `smart_think`, `smart_fast_apply({file, content})` |
| 7 | `smart_fast_apply({file, content})` |
| 8 | `smart_fast_apply({file, content})` |
| 9 | `smart_read`, `smart_fast_apply` |
| 10 | `bash` (rm), final report |
