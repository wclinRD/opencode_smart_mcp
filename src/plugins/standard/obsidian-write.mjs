// obsidian-write.mjs → smart_obsidian_write
// Phase 15.6: Write notes directly to an Obsidian vault.
// Supports frontmatter, tags, wikilinks, and auto-placement in vault folders.
//
// Usage:
//   smart_obsidian_write({ title: "...", content: "...", vault?: "..." })
//   smart_obsidian_write({ title: "...", content: "...", folder: "research", tags: ["ai","ml"] })

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Vault Detection ──────────────────────────────────────────────────────────

/**
 * Auto-detect Obsidian vault path.
 * Checks common locations and environment variables.
 */
function detectVaultPath() {
  // 1. Environment variable
  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH;
  }

  // 2. Common macOS locations
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Documents', 'Obsidian Vault'),
    path.join(home, 'Documents', 'Obsidian'),
    path.join(home, 'Obsidian'),
    path.join(home, 'vault'),
    path.join(home, 'wiki'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, '.obsidian'))) {
      return candidate;
    }
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a title for use as a filename.
 */
function sanitizeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

/**
 * Generate YAML frontmatter.
 */
function generateFrontmatter({ title, tags = [], created, category }) {
  const lines = ['---'];
  if (title) lines.push(`title: "${title}"`);
  lines.push(`created: ${created || new Date().toISOString().split('T')[0]}`);
  if (category) lines.push(`category: "${category}"`);
  if (tags.length > 0) lines.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// ── Main Handler ─────────────────────────────────────────────────────────────

/**
 * Write a note to an Obsidian vault.
 */
async function writeToObsidian(args) {
  const {
    title,
    content,
    vault,
    folder = '',
    tags = [],
    category,
    overwrite = false,
  } = args;

  if (!title || !title.trim()) {
    return { ok: false, error: 'title is required' };
  }

  if (!content || !content.trim()) {
    return { ok: false, error: 'content is required' };
  }

  // Detect vault path
  const vaultPath = vault || detectVaultPath();
  if (!vaultPath) {
    return {
      ok: false,
      error: 'No Obsidian vault found. Set OBSIDIAN_VAULT_PATH environment variable or pass vault parameter.',
      hint: 'export OBSIDIAN_VAULT_PATH="/path/to/your/vault"',
    };
  }

  if (!fs.existsSync(vaultPath)) {
    return { ok: false, error: `Vault path does not exist: ${vaultPath}` };
  }

  // Build target path
  const filename = sanitizeFilename(title) + '.md';
  let targetDir = vaultPath;
  if (folder) {
    targetDir = path.join(vaultPath, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }
  const filePath = path.join(targetDir, filename);

  // Check if exists
  if (fs.existsSync(filePath) && !overwrite) {
    return {
      ok: false,
      error: `File already exists: ${filePath}. Use overwrite:true to replace.`,
      existingPath: filePath,
    };
  }

  // Generate frontmatter + content
  const frontmatter = generateFrontmatter({ title, tags, created: new Date().toISOString().split('T')[0], category });
  const fullContent = frontmatter + content;

  // Write file
  fs.writeFileSync(filePath, fullContent, 'utf-8');

  return {
    ok: true,
    path: filePath,
    vault: vaultPath,
    folder: folder || '(root)',
    size: Buffer.byteLength(fullContent, 'utf-8'),
    tags,
  };
}

// ── Plugin Definition ────────────────────────────────────────────────────────

export default {
  name: 'smart_obsidian_write',
  category: 'standard',
  description: `Write a note directly to an Obsidian vault with YAML frontmatter.

Auto-detects vault location from:
  1. OBSIDIAN_VAULT_PATH environment variable
  2. Common macOS locations (~/Documents/Obsidian Vault, etc.)

Features:
  - YAML frontmatter with title, date, tags, category
  - Auto-placement in vault subfolders
  - Sanitized filenames from titles
  - Overwrite protection

Examples:
  { title: "My Research Note", content: "Findings...", tags: ["research", "ai"] }
  { title: "Meeting Notes", content: "...", folder: "meetings", vault: "/path/to/vault" }
  { title: "Update", content: "...", overwrite: true }`,

  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Note title (required, used as filename)',
      },
      content: {
        type: 'string',
        description: 'Note content in Markdown (required)',
      },
      vault: {
        type: 'string',
        description: 'Obsidian vault path (auto-detected if not provided)',
      },
      folder: {
        type: 'string',
        description: 'Subfolder within vault (created if not exists)',
      },
      tags: {
        type: 'array',
        description: 'Tags for YAML frontmatter',
        items: { type: 'string' },
      },
      category: {
        type: 'string',
        description: 'Category for YAML frontmatter',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite existing file (default: false)',
      },
    },
    required: ['title', 'content'],
  },

  handler: async (args) => {
    try {
      const result = await writeToObsidian(args);

      if (!result.ok) {
        let text = `## Obsidian Write Failed ❌\n\n`;
        text += `**Error**: ${result.error}\n`;
        if (result.hint) text += `\n**Hint**: ${result.hint}\n`;
        if (result.existingPath) text += `\n**Existing file**: \`${result.existingPath}\`\n`;
        return text;
      }

      let text = `## Obsidian Note Written ✅\n\n`;
      text += `| Field | Value |\n|-------|-------|\n`;
      text += `| Title | ${args.title} |\n`;
      text += `| Path | \`${result.path}\` |\n`;
      text += `| Vault | ${result.vault} |\n`;
      text += `| Folder | ${result.folder} |\n`;
      text += `| Size | ${(result.size / 1024).toFixed(1)} KB |\n`;
      if (result.tags.length > 0) text += `| Tags | ${result.tags.join(', ')} |\n`;
      text += `\nOpen in Obsidian to view: \`obsidian://open?file=${encodeURIComponent(args.title)}\``;

      return text;
    } catch (err) {
      return `Error writing to Obsidian: ${err.message}`;
    }
  },
};