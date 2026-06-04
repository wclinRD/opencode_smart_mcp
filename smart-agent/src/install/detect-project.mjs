// detect-project.mjs — Project type detection for Smart Agent
//
// Analyzes a project directory to determine its language, framework,
// and structural conventions. Used during installation to customize
// the opencode agent configuration.
//
// Usage:
//   import { detectProject } from 'smart-agent/install/detect-project';
//   const project = detectProject('/path/to/project');
//   // => { language: 'javascript', framework: 'express', structure: 'src/' }

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// Detection signatures
// ---------------------------------------------------------------------------

const LANGUAGE_DETECTORS = [
  { name: 'javascript', indicators: ['package.json', 'node_modules', 'index.js', 'src/index.js'] },
  { name: 'typescript', indicators: ['tsconfig.json', 'tsconfig.node.json', 'src/index.ts'] },
  { name: 'python', indicators: ['setup.py', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'main.py'] },
  { name: 'rust', indicators: ['Cargo.toml', 'Cargo.lock', 'src/main.rs'] },
  { name: 'go', indicators: ['go.mod', 'go.sum', 'main.go'] },
  { name: 'java', indicators: ['pom.xml', 'build.gradle', 'settings.gradle'] },
  { name: 'ruby', indicators: ['Gemfile', 'Gemfile.lock', 'Rakefile', 'config.ru'] },
  { name: 'csharp', indicators: ['*.csproj', '*.sln', 'Program.cs'] },
];

const FRAMEWORK_DETECTORS = {
  javascript: [
    { name: 'express', indicators: ['express', 'package.json'] },
    { name: 'react', indicators: ['react', 'react-dom', 'next.config'] },
    { name: 'vue', indicators: ['vue', 'nuxt.config'] },
    { name: 'angular', indicators: ['@angular/core', 'angular.json'] },
    { name: 'svelte', indicators: ['svelte', 'svelte.config'] },
    { name: 'fastify', indicators: ['fastify'] },
  ],
  typescript: [
    { name: 'nextjs', indicators: ['next', 'next.config'] },
    { name: 'nest', indicators: ['@nestjs/core'] },
    { name: 'react', indicators: ['react', 'react-dom'] },
    { name: 'vue', indicators: ['vue', 'nuxt.config'] },
    { name: 'angular', indicators: ['@angular/core'] },
    { name: 'sveltekit', indicators: ['svelte', '@sveltejs/kit'] },
  ],
  python: [
    { name: 'django', indicators: ['django', 'settings.py', 'urls.py', 'wsgi.py'] },
    { name: 'flask', indicators: ['flask', 'app.py', 'application.py'] },
    { name: 'fastapi', indicators: ['fastapi'] },
    { name: 'pytest', indicators: ['pytest'] },
  ],
  rust: [
    { name: 'axum', indicators: ['axum'] },
    { name: 'actix', indicators: ['actix-web'] },
    { name: 'rocket', indicators: ['rocket'] },
    { name: 'tokio', indicators: ['tokio'] },
  ],
  go: [
    { name: 'gin', indicators: ['gin-gonic'] },
    { name: 'echo', indicators: ['labstack/echo'] },
    { name: 'fiber', indicators: ['gofiber'] },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect project characteristics at the given root path.
 * @param {string} projectRoot - Absolute path to the project directory
 * @returns {{
 *   language: string,
 *   framework: string|null,
 *   hasSrcDir: boolean,
 *   hasTests: boolean,
 *   packageManager: string|null,
 *   detectedIndicators: string[]
 * }}
 */
export function detectProject(projectRoot = process.cwd()) {
  const result = {
    language: 'unknown',
    framework: null,
    hasSrcDir: false,
    hasTests: false,
    packageManager: null,
    detectedIndicators: [],
  };

  // Check for src directory
  result.hasSrcDir = existsSync(resolve(projectRoot, 'src'));

  // Check for test directories/files
  result.hasTests = (
    existsSync(resolve(projectRoot, 'tests')) ||
    existsSync(resolve(projectRoot, 'test')) ||
    existsSync(resolve(projectRoot, '__tests__')) ||
    existsSync(resolve(projectRoot, 'vitest.config.ts')) ||
    existsSync(resolve(projectRoot, 'jest.config.js'))
  );

  // Detect package manager
  if (existsSync(resolve(projectRoot, 'bun.lock'))) result.packageManager = 'bun';
  else if (existsSync(resolve(projectRoot, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm';
  else if (existsSync(resolve(projectRoot, 'yarn.lock'))) result.packageManager = 'yarn';
  else if (existsSync(resolve(projectRoot, 'package-lock.json'))) result.packageManager = 'npm';

  // Detect language
  for (const lang of LANGUAGE_DETECTORS) {
    for (const indicator of lang.indicators) {
      const indicatorPath = resolve(projectRoot, indicator);
      if (existsSync(indicatorPath) || fileGlob(projectRoot, indicator).length > 0) {
        result.language = lang.name;
        result.detectedIndicators.push(indicator);
        break;
      }
    }
    if (result.language !== 'unknown') break;
  }

  // Detect framework
  if (result.language !== 'unknown') {
    const frameworkDetectors = FRAMEWORK_DETECTORS[result.language] || [];

    // Check package.json for framework indicators
    const pkgJsonPath = resolve(projectRoot, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        for (const fw of frameworkDetectors) {
          for (const indicator of fw.indicators) {
            if (allDeps[indicator] || indicator.endsWith('.py') && existsSync(resolve(projectRoot, indicator))) {
              result.framework = fw.name;
              result.detectedIndicators.push(`framework:${fw.name}`);
              break;
            }
          }
          if (result.framework) break;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fileGlob(root, pattern) {
  // Simple file existence check for glob-like patterns
  if (pattern.includes('*')) {
    const parts = pattern.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const fullDir = resolve(root, dir);
    if (!existsSync(fullDir)) return [];
    try {
      const entries = readdirSync(fullDir);
      return entries.filter(e => {
        const re = new RegExp('^' + parts[parts.length - 1].replace(/\*/g, '.*') + '$');
        return re.test(e);
      }).map(e => join(dir, e));
    } catch {
      return [];
    }
  }
  return existsSync(resolve(root, pattern)) ? [pattern] : [];
}
