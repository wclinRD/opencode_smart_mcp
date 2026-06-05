#!/usr/bin/env node

// diagram.mjs — Mermaid.js diagram generator
//
// Generates Mermaid.js diagram definitions from structured data.
// Supports flowchart, sequenceDiagram, classDiagram, and ER diagrams.
//
// Usage:
//   node diagram.mjs <type> [options]
//   node diagram.mjs --from-import-graph <import-graph.json>
//
// Types:
//   flowchart        Generate flowchart diagram
//   sequence         Generate sequence diagram
//   class            Generate class diagram
//   er               Generate entity-relationship diagram
//
// Options:
//   --root <path>         Root directory (default: .)
//   --input <file>        Read input from JSON file
//   --from-import-graph   Read import-graph JSON output from stdin/file
//   --title <text>        Diagram title
//   --direction <dir>     Flowchart direction: TB, BT, LR, RL (default: TB)
//   --format <fmt>        Output: text, json, markdown (default: text)
//   --output <file>       Write output to file
//   --no-color            Disable color output
//   -h, --help            Show this help
//
// Examples:
//   node diagram.mjs flowchart --title "Project Architecture" --direction LR
//   node diagram.mjs sequence --input interactions.json
//   node import-graph.mjs --format json | node diagram.mjs --from-import-graph -
//   node diagram.mjs er --input schema.json

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLORS, useColor } from '../lib/utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^(\d)/, '_$1');
}

function sanitizeLabel(str) {
  return str.replace(/"/g, '#quot;').replace(/[<>]/g, (c) => ({ '<': '&lt;', '>': '&gt;' })[c]);
}

// ---------------------------------------------------------------------------
// Diagram generators
// ---------------------------------------------------------------------------

function generateFlowchart(data, opts) {
  const { nodes = [], edges = [], direction = 'TB', title } = data;
  const lines = [];
  lines.push(`---`);
  lines.push(`title: ${title || 'Flowchart'}`);
  lines.push(`---`);
  lines.push(`flowchart ${direction}`);
  lines.push('');

  const addedNodes = new Set();
  for (const edge of edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    if (!addedNodes.has(from)) {
      const label = sanitizeLabel(edge.fromLabel || edge.from);
      lines.push(`  ${from}["${label}"]`);
      addedNodes.add(from);
    }
    if (!addedNodes.has(to)) {
      const label = sanitizeLabel(edge.toLabel || edge.to);
      lines.push(`  ${to}["${label}"]`);
      addedNodes.add(to);
    }
    const style = edge.style || '-->';
    const edgeLabel = edge.label ? `|${sanitizeLabel(edge.label)}|` : '';
    lines.push(`  ${from} ${style}${edgeLabel} ${to}`);
  }

  // Add any standalone nodes
  for (const node of nodes) {
    const id = sanitizeId(node.id);
    if (!addedNodes.has(id)) {
      const label = sanitizeLabel(node.label || node.id);
      const shape = node.shape === 'circle' ? `(("${label}"))`
        : node.shape === 'diamond' ? `{"${label}"}`
        : node.shape === 'round' ? `("${label}")`
        : `["${label}"]`;
      lines.push(`  ${id}${shape}`);
      addedNodes.add(id);
    }
  }

  // Add subgraphs if any
  if (data.subgraphs) {
    for (const sg of data.subgraphs) {
      lines.push(`  subgraph ${sanitizeId(sg.id)}["${sanitizeLabel(sg.label)}"]`);
      for (const nodeId of sg.nodes) {
        lines.push(`    ${sanitizeId(nodeId)}`);
      }
      lines.push('  end');
    }
  }

  return lines.join('\n');
}

function generateSequence(data, opts) {
  const { participants = [], messages = [], title } = data;
  const lines = [];
  lines.push(`---`);
  lines.push(`title: ${title || 'Sequence Diagram'}`);
  lines.push(`---`);
  lines.push('sequenceDiagram');
  lines.push('');

  for (const p of participants) {
    const type = p.type === 'actor' ? 'Actor' : 'participant';
    const alias = p.alias ? ` as ${sanitizeId(p.alias)}` : '';
    lines.push(`  ${type} ${sanitizeId(p.id)}${alias}`);
  }

  for (const msg of messages) {
    const from = sanitizeId(msg.from);
    const to = sanitizeId(msg.to);
    const arrow = msg.type === 'async' ? '->>' : msg.type === 'reply' ? '-->>' : '->>';
    const label = sanitizeLabel(msg.label || '');
    lines.push(`  ${from}${arrow}${to}: ${label}`);
  }

  // Add notes
  if (data.notes) {
    for (const note of data.notes) {
      const pos = note.position || 'over';
      const target = Array.isArray(note.targets) ? note.targets.map(sanitizeId).join(', ') : sanitizeId(note.target);
      lines.push(`  Note ${pos} ${target}: ${sanitizeLabel(note.text)}`);
    }
  }

  return lines.join('\n');
}

function generateClassDiagram(data, opts) {
  const { classes = [], relations = [], title } = data;
  const lines = [];
  lines.push(`---`);
  lines.push(`title: ${title || 'Class Diagram'}`);
  lines.push(`---`);
  lines.push('classDiagram');
  lines.push('');

  for (const cls of classes) {
    lines.push(`  class ${sanitizeId(cls.name)} {`);
    if (cls.attributes) {
      for (const attr of cls.attributes) {
        const visibility = attr.public ? '+' : attr.protected ? '#' : '-';
        const type = attr.type ? ` ${attr.type}` : '';
        lines.push(`    ${visibility}${sanitizeId(attr.name)}${type}`);
      }
    }
    if (cls.methods) {
      for (const method of cls.methods) {
        const visibility = method.public ? '+' : method.protected ? '#' : '-';
        const args = method.args ? `(${method.args.join(', ')})` : '()';
        const ret = method.returnType ? ` ${method.returnType}` : '';
        lines.push(`    ${visibility}${sanitizeId(method.name)}${args}${ret}`);
      }
    }
    lines.push('  }');
  }

  for (const rel of relations) {
    const from = sanitizeId(rel.from);
    const to = sanitizeId(rel.to);
    const relationMap = {
      'extends': '<|--', 'implements': '<|..', 'composition': '*--',
      'aggregation': 'o--', 'association': '-->', 'dependency': '..>',
    };
    const arrow = relationMap[rel.type] || '-->';
    const label = rel.label ? ` : ${sanitizeLabel(rel.label)}` : '';
    lines.push(`  ${from} ${arrow} ${to}${label}`);
  }

  return lines.join('\n');
}

function generateER(data, opts) {
  const { entities = [], relations = [], title } = data;
  const lines = [];
  lines.push(`---`);
  lines.push(`title: ${title || 'ER Diagram'}`);
  lines.push(`---`);
  lines.push('erDiagram');
  lines.push('');

  for (const entity of entities) {
    lines.push(`  ${sanitizeId(entity.name)} {`);
    if (entity.attributes) {
      for (const attr of entity.attributes) {
        const key = attr.pk ? ' PK' : attr.fk ? ' FK' : '';
        const type = attr.type ? ` ${attr.type}` : '';
        lines.push(`    ${type}${sanitizeId(attr.name)}${key}`);
      }
    }
    lines.push('  }');
  }

  for (const rel of relations) {
    const from = sanitizeId(rel.from);
    const to = sanitizeId(rel.to);
    const cardMap = {
      '1:1': '||--||', '1:N': '||--o{', 'N:1': '}o--||', 'N:M': '}o--o{',
    };
    const card = cardMap[rel.cardinality] || '||--||';
    const label = rel.label ? ` : ${sanitizeLabel(rel.label)}` : '';
    lines.push(`  ${from} ${card} ${to}${label}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Import graph conversion
// ---------------------------------------------------------------------------

function convertImportGraph(importGraph) {
  const edges = [];
  const nodes = [];
  const fileSet = new Set();

  // importGraph has: { nodes: [{ path, file, imports[], importedBy[] }], externals: [...] }
  const graphNodes = importGraph.nodes || [];

  // Build a set of all internal files
  const internalFiles = new Map();
  for (const n of graphNodes) {
    internalFiles.set(n.path, n.file);
    fileSet.add(n.path);
  }

  // Build edges from import relationships
  const incomingCount = new Map();
  for (const n of graphNodes) {
    for (const imp of n.imports) {
      // If the import resolves to an internal file, create edge
      if (internalFiles.has(imp)) {
        edges.push({ from: n.path, to: imp, style: '-->' });
        incomingCount.set(imp, (incomingCount.get(imp) || 0) + 1);
      }
    }
  }

  // If no internal edges found, try using importedBy relationships
  if (edges.length === 0) {
    for (const n of graphNodes) {
      for (const importer of n.importedBy) {
        if (internalFiles.has(importer)) {
          edges.push({ from: importer, to: n.path, style: '-->' });
          incomingCount.set(n.path, (incomingCount.get(n.path) || 0) + 1);
        }
      }
    }
  }

  for (const path of fileSet) {
    nodes.push({ id: path, label: path.split(/[/\\]/).pop() });
  }

  // Identify root files (no incoming edges from internal files)
  const rootFiles = [...fileSet].filter(f => !incomingCount.has(f));

  return {
    nodes,
    edges,
    direction: 'LR',
    title: 'Import Dependency Graph',
    subgraphs: rootFiles.length > 0 ? [
      {
        id: 'root_files',
        label: 'Entry Points',
        nodes: rootFiles.slice(0, 20), // limit to 20 for readability
      },
    ] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatText(diagram, opts, color) {
  const c = COLORS;
  const lines = diagram.split('\n');

  if (color) {
    const typeColors = {
      flowchart: c.cyan, sequenceDiagram: c.magenta,
      classDiagram: c.green, erDiagram: c.yellow,
    };
    const firstLine = lines.find(l => l.startsWith('flowchart') || l.startsWith('sequenceDiagram') || l.startsWith('classDiagram') || l.startsWith('erDiagram'));
    const type = firstLine?.match(/^(flowchart|sequenceDiagram|classDiagram|erDiagram)/)?.[1];
    const header = type ? `${c.bold}${typeColors[type] || c.blue}${type}${c.reset}` : 'Diagram';
    return `${header}\n${'='.repeat(40)}\n\n${diagram}`;
  }

  return diagram;
}

function formatJson(diagram) {
  return JSON.stringify({ diagram, type: detectType(diagram), mermaid: true }, null, 2);
}

function formatMarkdown(diagram) {
  return `\`\`\`mermaid\n${diagram}\n\`\`\``;
}

function detectType(diagram) {
  if (diagram.includes('flowchart ')) return 'flowchart';
  if (diagram.includes('sequenceDiagram')) return 'sequence';
  if (diagram.includes('classDiagram')) return 'class';
  if (diagram.includes('erDiagram')) return 'er';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node diagram.mjs <type> [options]

Mermaid.js diagram generator. Converts structured data into
Mermaid.js diagram definitions.

Types:
  flowchart        Generate flowchart diagram
  sequence         Generate sequence diagram
  class            Generate class diagram
  er               Generate entity-relationship diagram

Options:
  --root <path>         Root directory (default: .)
  --input <file>        Read input from JSON file
  --from-import-graph   Read import-graph JSON output from stdin/file
  --title <text>        Diagram title
  --direction <dir>     Flowchart direction: TB, BT, LR, RL (default: TB)
  --format <fmt>        Output: text, json, markdown (default: text)
  --output <file>       Write output to file
  --no-color            Disable color output
  -h, --help            Show this help

Examples:
  node import-graph.mjs --format json | node diagram.mjs --from-import-graph -
  node diagram.mjs flowchart --title "Architecture" --input deps.json
  node diagram.mjs sequence --input interactions.json --format markdown
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const knownTypes = ['flowchart', 'sequence', 'class', 'er'];
  const opts = {
    type: knownTypes.includes(args[0]) ? args[0] : null,
    commandArgs: [],
    root: '.',
    format: 'text',
    title: '',
    direction: 'TB',
    input: null,
    fromImportGraph: false,
    color: undefined,
    output: null,
  };

  if (!opts.type && !args[0].startsWith('--')) {
    console.error(`Unknown diagram type: ${args[0]}`);
    console.error(`Valid types: ${knownTypes.join(', ')}`);
    process.exit(1);
  }

  let i = opts.type ? 1 : 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--root': opts.root = args[++i]; break;
      case '--format': opts.format = args[++i]; break;
      case '--title': opts.title = args[++i]; break;
      case '--direction': opts.direction = args[++i]; break;
      case '--input': opts.input = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--from-import-graph': opts.fromImportGraph = true; break;
      case '--no-color': opts.color = false; break;
      case '--color': opts.color = true; break;
    }
    i++;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const color = useColor(opts);

  let data = { title: opts.title, direction: opts.direction };

  // Read input data
  if (opts.fromImportGraph) {
    let jsonInput;
    if (opts.input === '-' || opts.input === null) {
      jsonInput = await readStdin();
    } else {
      const content = readFileSafe(resolve(opts.root, opts.input));
      if (!content) {
        console.error(`Cannot read input file: ${opts.input}`);
        process.exit(1);
      }
      jsonInput = content;
    }
    try {
      const importGraph = JSON.parse(jsonInput);
      data = { ...convertImportGraph(importGraph), ...data };
      opts.type = 'flowchart';
    } catch (e) {
      console.error(`Invalid import-graph JSON: ${e.message}`);
      process.exit(1);
    }
  } else if (opts.input) {
    const filePath = resolve(opts.root, opts.input);
    const content = readFileSafe(filePath);
    if (!content) {
      console.error(`Cannot read input file: ${opts.input}`);
      process.exit(1);
    }
    try {
      const jsonData = JSON.parse(content);
      data = { ...jsonData, ...data };
    } catch (e) {
      console.error(`Invalid JSON in input file: ${e.message}`);
      process.exit(1);
    }
  }

  // If data is provided via stdin as plain JSON (no --from-import-graph)
  if (!opts.input && !opts.fromImportGraph && !process.stdin.isTTY) {
    try {
      const stdinData = await readStdin();
      if (stdinData.trim()) {
        const parsed = JSON.parse(stdinData);
        data = { ...parsed, ...data };
      }
    } catch { /* not JSON input, ignore */ }
  }

  // Generate diagram
  let diagram;
  switch (opts.type) {
    case 'flowchart':
      diagram = generateFlowchart(data, opts);
      break;
    case 'sequence':
      diagram = generateSequence(data, opts);
      break;
    case 'class':
      diagram = generateClassDiagram(data, opts);
      break;
    case 'er':
      diagram = generateER(data, opts);
      break;
    default:
      console.error(`No diagram type specified. Use: flowchart, sequence, class, er`);
      process.exit(1);
  }

  // Format output
  let output;
  switch (opts.format) {
    case 'json':
      output = formatJson(diagram);
      break;
    case 'markdown':
      output = formatMarkdown(diagram);
      break;
    case 'text':
    default:
      output = formatText(diagram, opts, color);
      break;
  }

  // Write or print
  if (opts.output) {
    writeFileSync(resolve(opts.root, opts.output), output, 'utf-8');
    console.log(`Diagram written to ${opts.output}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
