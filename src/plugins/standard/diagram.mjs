export default {
  name: 'smart_diagram',
  category: 'report',
  description: 'Use when: need to visualize architecture, workflow, or data flow as Mermaid.js diagram. Supports flowchart, sequence, class, ER. Can convert import-graph output to visual. Useful for documentation or design discussions.',
  inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['flowchart', 'sequence', 'class', 'er'], description: 'Diagram type' }, title: { type: 'string', description: 'Diagram title' }, direction: { type: 'string', enum: ['TB', 'BT', 'LR', 'RL'], description: 'Flowchart direction (default: TB)' }, input: { type: 'string', description: 'Input JSON file path' }, fromImportGraph: { type: 'boolean', description: 'Read import-graph JSON from stdin/file' }, format: { type: 'string', enum: ['text', 'json', 'markdown'], description: 'Output format (default: text)' }, root: { type: 'string', description: 'Root directory (default: .)' } }, required: ['type'] },
  cli: 'diagram.mjs',
  mapArgs(a) { const cli = []; if (a.type) cli.push(String(a.type)); if (a.title) cli.push('--title', String(a.title)); if (a.direction) cli.push('--direction', String(a.direction)); if (a.input) cli.push('--input', String(a.input)); if (a.fromImportGraph) cli.push('--from-import-graph'); if (a.format) cli.push('--format', String(a.format)); if (a.root) cli.push('--root', String(a.root)); cli.push('--no-color'); return cli; },
};
