// docx-generate.mjs → smart_docx_generate
// Phase 15.5: APA 7th formatted DOCX generation plugin.
// Wraps the `docx` npm library for programmatic Word document creation.
// Integrated from Deep Research Agent (CYC2002tommy/deep-research-agent, MIT).
//
// Usage:
//   smart_docx_generate({ title: "...", sections: [...], references: [...], outputPath: "..." })
//   smart_docx_generate({ title: "...", abstract: "...", body: "...", references: "..." })

import fs from 'node:fs';
import path from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, BorderStyle,
} from 'docx';

// ── APA 7th Formatting Constants ─────────────────────────────────────────────

const APA = {
  // Hanging indent for references: 0.5 inch = 720 twips
  hangingIndent: { left: 720, hanging: 720 },
  // Font
  font: 'Times New Roman',
  fontSize: 24, // 12pt in half-points
  headingFontSize: 28, // 14pt
  titleFontSize: 32, // 16pt
  // Spacing
  lineSpacing: 360, // double-spaced = 2.0 * 240 twips
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { after: 200, line: APA.lineSpacing },
  });
}

function body(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: APA.font, size: APA.fontSize })],
    spacing: { after: 120, line: APA.lineSpacing },
    indent: { firstLine: 720 }, // 0.5 inch first-line indent
  });
}

function bodyNoIndent(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: APA.font, size: APA.fontSize })],
    spacing: { after: 120, line: APA.lineSpacing },
  });
}

function abstractPara(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: 'Abstract', bold: true, italics: false, font: APA.font, size: APA.fontSize }),
    ],
    spacing: { after: 120, line: APA.lineSpacing },
    alignment: AlignmentType.CENTER,
  });
}

function reference(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: APA.font, size: APA.fontSize })],
    indent: APA.hangingIndent,
    spacing: { after: 60, line: APA.lineSpacing },
  });
}

function emptyLine() {
  return new Paragraph({ text: '', spacing: { after: 0 } });
}

/**
 * Build a table from a 2D array of strings. First row is header.
 */
function buildTable(data, columnWidths) {
  if (!data || data.length === 0) return emptyLine();

  const headerRow = new TableRow({
    children: data[0].map((cell, i) =>
      new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cell, bold: true, font: APA.font, size: 20 })],
        })],
        width: columnWidths ? { size: columnWidths[i], type: WidthType.PERCENTAGE } : undefined,
      })
    ),
  });

  const dataRows = data.slice(1).map((row) =>
    new TableRow({
      children: row.map((cell, i) =>
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: cell, font: APA.font, size: 20 })],
          })],
          width: columnWidths ? { size: columnWidths[i], type: WidthType.PERCENTAGE } : undefined,
        })
      ),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ── Main Generator ───────────────────────────────────────────────────────────

/**
 * Generate an APA 7th formatted DOCX document.
 *
 * @param {object} args
 * @param {string} args.title - Document title
 * @param {string} [args.abstract] - Abstract text
 * @param {Array<{heading: string, content: string|string[]}>} [args.sections] - Body sections
 * @param {string[]} [args.references] - APA 7th formatted reference strings
 * @param {Array<{title: string, data: string[][]}>} [args.tables] - Tables (2D arrays, first row = header)
 * @param {string} [args.outputPath] - Output file path (default: ./output.docx)
 * @param {string} [args.author] - Document author metadata
 *
 * @returns {Promise<object>} { ok, path, size }
 */
async function generateDOCX(args) {
  const {
    title = 'Untitled Document',
    abstract,
    sections = [],
    references = [],
    tables = [],
    outputPath,
    author = 'Smart MCP',
  } = args;

  const children = [];

  // ── Title Page ──
  children.push(emptyLine());
  children.push(emptyLine());
  children.push(new Paragraph({
    children: [new TextRun({ text: title, bold: true, font: APA.font, size: APA.titleFontSize })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400, line: APA.lineSpacing },
  }));
  children.push(emptyLine());

  // ── Abstract ──
  if (abstract) {
    children.push(heading('Abstract', HeadingLevel.HEADING_2));
    children.push(bodyNoIndent(abstract));
    children.push(emptyLine());
  }

  // ── Body Sections ──
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (typeof section === 'string') {
      // Simple string = body paragraph
      children.push(body(section));
    } else if (section.heading) {
      // Section with heading
      const level = section.level || (i === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2);
      children.push(heading(section.heading, level));

      if (typeof section.content === 'string') {
        // Split by double newlines into paragraphs
        const paragraphs = section.content.split(/\n\n+/).filter(Boolean);
        for (const para of paragraphs) {
          children.push(body(para.trim()));
        }
      } else if (Array.isArray(section.content)) {
        for (const para of section.content) {
          children.push(body(para));
        }
      }
    }
  }

  // ── Tables ──
  for (const table of tables) {
    if (table.title) {
      children.push(new Paragraph({
        children: [new TextRun({ text: table.title, italics: true, font: APA.font, size: APA.fontSize })],
        spacing: { after: 60 },
      }));
    }
    if (table.data && table.data.length > 0) {
      children.push(buildTable(table.data, table.columnWidths));
      children.push(emptyLine());
    }
  }

  // ── References ──
  if (references.length > 0) {
    children.push(new Paragraph({ text: '', spacing: { after: 200 } })); // page break spacer
    children.push(heading('References', HeadingLevel.HEADING_2));
    for (const ref of references) {
      children.push(reference(ref));
    }
  }

  // ── Build Document ──
  const doc = new Document({
    creator: author,
    title,
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);

  // Determine output path
  let outPath = outputPath;
  if (!outPath) {
    // Default: sanitized title in current directory
    const safeName = title.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
    outPath = path.resolve(process.cwd(), `${safeName || 'output'}.docx`);
  } else if (!path.isAbsolute(outPath)) {
    outPath = path.resolve(process.cwd(), outPath);
  }

  // Ensure directory exists
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outPath, buffer);

  return {
    ok: true,
    path: outPath,
    size: buffer.length,
    sections: sections.length,
    references: references.length,
    tables: tables.length,
  };
}

// ── Plugin Definition ────────────────────────────────────────────────────────

export default {
  name: 'smart_docx_generate',
  category: 'standard',
  description: `Generate APA 7th formatted Microsoft Word (.docx) documents programmatically.

Creates professional academic documents with:
  - Title page with centered title
  - Abstract section
  - Numbered body sections with proper heading hierarchy
  - Data tables with header rows
  - APA 7th reference list with hanging indents (0.5 inch)
  - Times New Roman 12pt, double-spaced

Input structure:
  { title, abstract?, sections: [{heading, content}], references: [...], tables: [{title, data}], outputPath? }

Examples:
  { title: "My Research", abstract: "This paper...", sections: [{heading:"Introduction", content:"..."}], references: ["Smith, J. (2024)..."], outputPath: "/tmp/paper.docx" }`,

  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Document title (required)',
      },
      abstract: {
        type: 'string',
        description: 'Abstract text',
      },
      sections: {
        type: 'array',
        description: 'Body sections. Each: { heading: string, content: string|string[], level?: number }. Or plain strings for simple paragraphs.',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            content: { description: 'String (split by double newlines) or array of paragraph strings' },
            level: { type: 'number', description: 'Heading level 1-5 (default: auto)' },
          },
        },
      },
      references: {
        type: 'array',
        description: 'APA 7th formatted reference strings',
        items: { type: 'string' },
      },
      tables: {
        type: 'array',
        description: 'Tables. Each: { title?: string, data: string[][], columnWidths?: number[] }',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            data: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            columnWidths: { type: 'array', items: { type: 'number' } },
          },
        },
      },
      outputPath: {
        type: 'string',
        description: 'Output file path (default: ./<title>.docx in current directory)',
      },
      author: {
        type: 'string',
        description: 'Document author metadata (default: "Smart MCP")',
      },
    },
    required: ['title'],
  },

  handler: async (args) => {
    const { title } = args;

    if (!title || !title.trim()) {
      return 'Error: title is required. Provide a document title.';
    }

    try {
      const result = await generateDOCX(args);

      let text = `## DOCX Generated Successfully ✅\n\n`;
      text += `| Field | Value |\n|-------|-------|\n`;
      text += `| Title | ${title} |\n`;
      text += `| Path | \`${result.path}\` |\n`;
      text += `| Size | ${(result.size / 1024).toFixed(1)} KB |\n`;
      text += `| Sections | ${result.sections} |\n`;
      text += `| References | ${result.references} |\n`;
      text += `| Tables | ${result.tables} |\n`;
      text += `\n**Format**: APA 7th — Times New Roman 12pt, double-spaced, hanging indent references.\n`;
      text += `\nUse \`smart_ingest_document({ path: "${result.path}" })\` to read the generated document.`;

      return text;
    } catch (err) {
      return `Error generating DOCX: ${err.message}`;
    }
  },
};