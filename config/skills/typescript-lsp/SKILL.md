---
name: typescript-lsp
description: TypeScript/JavaScript language server (typescript-language-server v5.3.0) — code intelligence, diagnostics, and refactoring support. Use when working with TS/JS code, fixing type errors, or need code analysis.
compatibility: opencode
metadata:
  lsp-server: typescript-language-server
  language: "TypeScript/JavaScript"
  version: 5.3.0
---

# TypeScript/JavaScript LSP Support

Language server for TypeScript/JavaScript using `typescript-language-server`.
Provides code completion, diagnostics, refactoring, and more.

## CLI Usage

```bash
# Start LSP server in stdio mode (for editor integration)
typescript-language-server --stdio

# Start with specific tsconfig
typescript-language-server --stdio --tsconfig-path tsconfig.json
```

## Configuration

Create `tsconfig.json` for project-wide settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

## Capabilities

- Code completion with auto-import
- Go to definition / find references
- Diagnostics and error checking
- Code refactoring (rename, extract)
- Hover type information
- Document symbols
- Organize imports
- Quick fixes

## Integration Tips

- Create `tsconfig.json` at project root for proper analysis
- Use JSDoc comments for type hints in `.js` files
- Run `npx tsc --noEmit` alongside for full type checking
- LSP server communicates via stdio protocol (for IDE integration)

## Notes

OpenCode does not have native LSP server configuration. Use CLI tools directly.
