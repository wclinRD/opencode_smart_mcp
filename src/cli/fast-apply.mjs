#!/usr/bin/env node

// fast-apply.mjs — CLI wrapper for smart_fast_apply
//
// Usage:
//   node fast-apply.mjs search-replace --block file.js "old code" "new code"
//   node fast-apply.mjs lazy --block file.js "// ... marker block" "full replace"
//   node fast-apply.mjs partial --block file.js "abbreviated search" "full replace"
//   node fast-apply.mjs unified-diff --diff < unified.diff
//   node fast-apply.mjs whole-file --whole file.js --content "new content"
//
// Options:
//   --dry-run             Only show what would change (default: true)
//   --apply               Actually apply changes
//   --fuzzy               Enable fuzzy matching (default: true)
//   --no-fuzzy            Disable fuzzy matching
//   --lazy                Enable lazy marker expansion
//   --partial             Enable partial context matching (L5)
//   --validate            Check syntax after apply
//   --undo                Create .bak snapshots (default: true)
//   --no-undo             Skip backups
//   --atomic              Atomic multi-file apply
//   --format <fmt>        Output: text, json, diff, ansi (default: text)
//   --root <path>         Project root
//   -h, --help            Show this help

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applySearchReplace,
  applySearchReplaceWithLazy,
  applyPartial,
  applyWholeFile,
  applyUnifiedDiff,
  parseSearchReplaceText,
  parseUnifiedDiff,
} from '../lib/apply-engine.mjs';

const HELP = `fast-apply — Apply LLM code edits fast

USAGE:
  node fast-apply.mjs <mode> [options]

MODES:
  search-replace    Apply SEARCH/REPLACE blocks (default)
  lazy              Apply with lazy marker expansion (// ... existing code ...)
  partial           Apply with abbreviated SEARCH context (L5 matching)
  unified-diff      Apply unified diff (from stdin or --diff)
  whole-file        Replace entire file

OPTIONS (search-replace / lazy / partial):
  --block <file> <search> <replace>   Single block
  --text <text>                       Raw text with <<<<<<< SEARCH blocks
  --file <path>                       Read SEARCH/REPLACE text from file
  --lazy                              Use lazy marker expansion (auto-detect from mode)
  --partial                           Use partial context matching

OPTIONS (unified-diff):
  --diff <text>                       Diff string to apply
  --file <path>                       Read diff from file
  (if omitted, reads stdin)

OPTIONS (whole-file):
  --file <path>                       Target file path
  --content <text>                    New file content
  --content-file <path>               Read new content from file

BEHAVIOR:
  --dry-run           Preview only (default: true)
  --apply             Actually apply
  --fuzzy / --no-fuzzy   Fuzzy matching (default: on)
  --validate          Check brace balance after apply
  --undo / --no-undo  Create .apply.bak snapshots (default: on)
  --atomic            Apply all changes atomically with rollback
  --root <dir>        Project root (default: cwd)
  --format <fmt>      Output: text, json, diff, ansi (default: text)
  -h, --help          Show this help

EXAMPLES:
  node fast-apply.mjs search-replace --block src/a.js "old()" "new()" --dry-run
  node fast-apply.mjs lazy --block src/a.js "//...existing..." "full replace" --apply
  node fast-apply.mjs partial --block src/a.js "abbreviated" "full replace" --apply
  node fast-apply.mjs search-replace --text "\$(cat patch.txt)" --apply
  diff -u old.js new.js | node fast-apply.mjs unified-diff --apply
  node fast-apply.mjs whole-file --file src/a.js --content "\$(cat new.js)" --apply
`;

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }

  const mode = args[0] || 'search-replace';
  if (!['search-replace', 'lazy', 'partial', 'unified-diff', 'whole-file'].includes(mode)) {
    console.error(`Unknown mode: ${mode}\n${HELP}`);
    process.exit(1);
  }

  const opts = {
    mode,
    dryRun: true,
    fuzzy: true,
    validate: false,
    undo: true,
    atomic: false,
    format: 'text',
    root: process.cwd(),
    blocks: [],
    diff: null,
    whole: null,
  };

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--apply': opts.dryRun = false; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--fuzzy': opts.fuzzy = true; break;
      case '--no-fuzzy': opts.fuzzy = false; break;
      case '--validate': opts.validate = true; break;
      case '--undo': opts.undo = true; break;
      case '--no-undo': opts.undo = false; break;
      case '--atomic': opts.atomic = true; break;
      case '--format': opts.format = args[++i]; break;
      case '--root': opts.root = resolve(args[++i]); break;
      case '--block': {
        const file = args[++i];
        const search = args[++i] || '';
        const replace = args[++i] || '';
        opts.blocks.push({ file, search, replace });
        break;
      }
      case '--text': opts.text = args[++i]; break;
      case '--diff': opts.diff = args[++i]; break;
      case '--content': opts.content = args[++i]; break;
      case '--file': opts.file = args[++i]; break;
      case '--content-file': {
        const p = args[++i];
        try { opts.content = readFileSync(p, 'utf-8'); } catch (e) {
          console.error(`Cannot read ${p}: ${e.message}`); process.exit(1);
        }
        break;
      }
      default:
        // Assume positional: file search replace (for --block shorthand)
        if (!opts.blocks.length && !a.startsWith('-')) {
          const file = a;
          const search = args[++i] || '';
          const replace = args[++i] || '';
          opts.blocks.push({ file, search, replace });
        }
    }
  }

  // Read diff from stdin if no --diff and mode=unified-diff
  if (mode === 'unified-diff' && !opts.diff && !opts.text) {
    const stdin = readStdinSync();
    if (stdin) opts.diff = stdin;
  }

  return opts;
}

function readStdinSync() {
  try {
    const buf = readFileSync('/dev/stdin', 'utf-8');
    return buf || null;
  } catch {
    return null;
  }
}

// ── ANSI color helpers (for --format=ansi) ──
const CLI_ANSI = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

let _cliOpts = null;
function useAnsi() { return _cliOpts && _cliOpts.format === 'ansi'; }

/** Replace emoji with ANSI-colored text when --format=ansi */
function ansiFormat(msg) {
  return msg
    .replace(/🔍 /g,     CLI_ANSI.bold(CLI_ANSI.cyan('◆ ')))
    .replace(/✅ /g,     CLI_ANSI.green('✓ '))
    .replace(/❌ /g,     CLI_ANSI.red('✗ '))
    .replace(/⚠️  /g,   CLI_ANSI.yellow('⚠ '))
    .replace(/📄 /g,    CLI_ANSI.cyan('file: '))
    .replace(/💡 /g,    CLI_ANSI.dim('tip: '))
    .replace(/^=+$/gm, (m) => CLI_ANSI.dim(m));
}

function log(...args) {
  if (useAnsi()) {
    console.log(...args.map(a => typeof a === 'string' ? ansiFormat(a) : a));
  } else {
    console.log(...args);
  }
}

// ---- Main ----
async function main() {
  const opts = parseArgs();
  _cliOpts = opts;

  if (opts.mode === 'search-replace' || opts.mode === 'lazy' || opts.mode === 'partial') {
    let blocks = opts.blocks;

    // Determine apply function based on mode
    const applyFn = opts.mode === 'lazy' ? applySearchReplaceWithLazy
      : opts.mode === 'partial' ? applyPartial
      : applySearchReplace;

    // Parse from text if provided
    if (opts.text) {
      blocks = parseSearchReplaceText(opts.text);
    } else if (opts.file) {
      const text = readFileSync(opts.file, 'utf-8');
      blocks = parseSearchReplaceText(text);
    }

    if (!blocks || blocks.length === 0) {
      log('No SEARCH/REPLACE blocks provided.');
      log('  Use --block <file> <search> <replace> or --text or --file');
      process.exit(1);
    }

    // Resolve file paths
    for (const b of blocks) {
      if (b.file && !b.file.startsWith('/')) {
        b.file = resolve(opts.root, b.file);
      }
    }

    const multiFile = blocks.length > 2;

    if (opts.dryRun) {
      log(`🔍 DRY RUN — ${blocks.length} block(s)`);
      log('='.repeat(50));
      if (multiFile) log(`\n⚠️  Multi-file change (${blocks.length} files).`);
      log('');

      for (const b of blocks) {
        log(`  📄 ${b.file}`);
        log(`     Search: ${b.search.split('\n').length} lines`);
        log(`     Replace: ${b.replace.split('\n').length} lines`);
        log('');
      }

      log(`💡 Run with --apply to apply.`);
      return;
    }

    // Apply
    for (const b of blocks) {
      const r = applyFn(b.file, { search: b.search, replace: b.replace }, {
        fuzzy: opts.fuzzy,
        validate: opts.validate,
        undo: opts.undo,
      });

      const icon = r.status === 'applied' ? '✅' : r.status === 'conflict' ? '❌' : '⚠️';
      log(`${icon} ${r.file} — ${r.status}`);
      if (r.matchLevel && r.matchLevel > 2) log(`   ⚡ Fuzzy match level ${r.matchLevel}`);
      if (r.error) log(`   ${r.error}`);
    }

  } else if (opts.mode === 'unified-diff') {
    const diffText = opts.diff || opts.text || '';
    if (!diffText) { log('No diff provided. Pipe to stdin or use --diff.'); process.exit(1); }

    const parsed = parseUnifiedDiff(diffText);
    if (parsed.length === 0) { log('No changes parsed from diff.'); process.exit(1); }

    // Resolve file paths
    for (const f of parsed) {
      if (f.file && !f.file.startsWith('/')) {
        f.file = resolve(opts.root, f.file);
      }
    }

    if (opts.dryRun) {
      log(`🔍 DRY RUN — ${parsed.length} file(s) in diff`);
      log('='.repeat(50));
      for (const f of parsed) {
        log(`  📄 ${f.file} (${f.hunks.length} hunk(s))`);
      }
      log(`\n💡 Run with --apply to apply.`);
      return;
    }

    for (const f of parsed) {
      const r = applyUnifiedDiff(f.file, f.hunks, { undo: opts.undo });
      const icon = r.status === 'applied' ? '✅' : '⚠️';
      log(`${icon} ${r.file} — ${r.status}`);
      if (r.error) log(`   ${r.error}`);
    }

  } else if (opts.mode === 'whole-file') {
    let file = opts.file;
    let content = opts.content;

    if (!file) { log('--file required for whole-file mode.'); process.exit(1); }
    if (!content && opts.file) {
      // Try reading content from .new file
      try { content = readFileSync(file + '.new', 'utf-8'); } catch { /* */ }
    }
    if (!content) { log('--content or --content-file required for whole-file mode.'); process.exit(1); }

    if (!file.startsWith('/')) file = resolve(opts.root, file);

    if (opts.dryRun) {
      log(`🔍 DRY RUN — Whole file replacement`);
      log('='.repeat(50));
      log(`  📄 ${file}`);
      log(`  New content: ${content.split('\n').length} lines`);
      log(`\n💡 Run with --apply to replace.`);
      return;
    }

    const r = applyWholeFile(file, content, { undo: opts.undo });
    const icon = r.status === 'applied' ? '✅' : '⚠️';
    log(`${icon} ${r.file} — ${r.status}`);
    if (r.error) log(`   ${r.error}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
