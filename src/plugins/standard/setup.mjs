// setup.mjs → smart_setup (via smart_smart_run router)
// Project onboarding — detect project type, generate opencode.json config.
//
// Usage:
//   ssr({tool:"setup", args:{root:"."}})
//   ssr({tool:"setup", args:{root:".", generate:true}})  // write opencode.json
//   ssr({tool:"setup", args:{root:".", dryRun:true}})     // preview only
//
// Targets: Node.js projects (most common). Detects language/framework
// and suggests agent config appropriate for the project type.

import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { detectProject } from '../../install/detect-project.mjs';

const SETUP_FILE = '.opencode/setup.jsonc';

// ---------------------------------------------------------------------------
// Config templates per language
// ---------------------------------------------------------------------------
function getAgentConfig(project) {
  const roleInstructions = {
    javascript: 'You are a JavaScript/Node.js engineer. Follow ES module conventions, use async/await, prefer functional patterns.',
    typescript: 'You are a TypeScript engineer. Write strict type-safe code, avoid `any`, use interfaces over types where appropriate.',
    python: 'You are a Python engineer. Follow PEP 8, use type hints, prefer list comprehensions, write docstrings.',
    rust: 'You are a Rust engineer. Follow Rust idioms, prefer ownership patterns, write unit tests in-module.',
    go: 'You are a Go engineer. Follow Go conventions, use interfaces, prefer composition over inheritance.',
    java: 'You are a Java engineer. Follow OOP patterns, use dependency injection, write JUnit tests.',
    ruby: 'You are a Ruby engineer. Follow Ruby idioms, prefer blocks, write RSpec tests.',
    csharp: 'You are a C# engineer. Follow .NET conventions, use async/await, write xUnit tests.',
    unknown: 'Write clean, maintainable, well-tested code.',
  };

  return {
    agent: project.language || 'unknown',
    language: project.language || 'unknown',
    framework: project.framework,
    hasTests: project.hasTests,
    srcDir: project.hasSrcDir ? 'src/' : '.',
    packageManager: project.packageManager || 'npm',
    role: roleInstructions[project.language] || roleInstructions.unknown,
    config: generateOpencodeSnippet(project),
  };
}

function generateOpencodeSnippet(project) {
  const config = {
    agent: 'smart',
    model: 'opencode/big-pickle',
    rules: [],
  };

  if (project.hasSrcDir) {
    config.rules.push('Source code is in src/');
  }
  if (project.hasTests) {
    config.rules.push('Write tests before implementation (TDD)');
  }
  if (project.packageManager) {
    config.rules.push(`Use ${project.packageManager} for dependencies`);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
export default {
  name: 'setup',
  category: 'standard',
  description: `Project onboarding — detect project type and generate configuration.
Analyzes the project directory to determine language, framework, and conventions.
Optionally generates a minimal opencode.json config for the project.
Use when: entering a new project, setting up agent config for a project.`,

  inputSchema: {
    type: 'object',
    properties: {
      root: {
        type: 'string',
        description: 'Project root directory (default: current working directory)',
      },
      generate: {
        type: 'boolean',
        description: 'Actually write the setup config (default: false, preview only)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview detected info without writing (default: true when generate is false)',
      },
    },
  },

  handler: async (args) => {
    const root = args.root || process.cwd();
    const generate = args.generate === true;
    const dryRun = args.dryRun === true || !generate;

    // 1. Detect project
    const project = detectProject(resolve(root));

    // 2. Build agent config
    const agentConfig = getAgentConfig(project);

    // 3. Generate recommendations
    const recommendations = [];

    if (!project.hasTests) {
      recommendations.push('📋 No test directory detected. Consider adding tests/ or __tests__/.');
    }
    if (!project.hasSrcDir) {
      recommendations.push('📁 No src/ directory. Consider organizing code under src/.');
    }
    if (project.language === 'unknown') {
      recommendations.push('❓ Unknown project type. Add a package.json, pyproject.toml, or Cargo.toml for better detection.');
    }

    // 4. Write if requested
    let wrote = false;
    if (generate) {
      const setupDir = resolve(root, '.opencode');
      const setupPath = join(setupDir, 'setup.jsonc');
      if (!existsSync(setupDir)) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(setupDir, { recursive: true });
      }
      const content = JSON.stringify(agentConfig, null, 2);
      writeFileSync(setupPath, content, 'utf-8');
      wrote = true;
    }

    // 5. Return result
    const result = {
      ok: true,
      project,
      agentConfig,
      recommendations,
      wrote,
      dryRun,
    };

    return JSON.stringify(result, null, 2);
  },
};
