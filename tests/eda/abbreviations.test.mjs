// abbreviations.test.mjs — EDA 縮寫展開測試
// Phase 9.3: tests/eda/ 單元測試

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDA_ABBREV_DICT,
  expandAbbreviations,
  lookupAbbreviation,
} from '../../src/plugins/core/eda/data/abbreviations.mjs';

// ── EDA_ABBREV_DICT ────────────────────────────────────────────────────

describe('EDA_ABBREV_DICT', () => {
  it('has 180+ entries', () => {
    const count = Object.keys(EDA_ABBREV_DICT).length;
    assert.ok(count >= 180, `Expected 180+ entries, got ${count}`);
  });

  it('each entry has full name', () => {
    for (const [abbr, entry] of Object.entries(EDA_ABBREV_DICT)) {
      assert.ok(entry.full, `Missing 'full' for abbreviation: ${abbr}`);
    }
  });

  it('tool entries have vendor', () => {
    const toolEntries = Object.entries(EDA_ABBREV_DICT).filter(([, e]) => e.category === 'tool');
    for (const [abbr, entry] of toolEntries) {
      assert.ok(entry.vendor, `Missing 'vendor' for tool abbreviation: ${abbr}`);
    }
  });

  it('contains key EDA abbreviations', () => {
    assert.ok(EDA_ABBREV_DICT['dc']);
    assert.ok(EDA_ABBREV_DICT['pt']);
    assert.ok(EDA_ABBREV_DICT['sta']);
    assert.ok(EDA_ABBREV_DICT['drc']);
    assert.ok(EDA_ABBREV_DICT['lvs']);
    assert.ok(EDA_ABBREV_DICT['vivado']);
  });
});

// ── expandAbbreviations ────────────────────────────────────────────────

describe('expandAbbreviations', () => {
  it('expands single abbreviation', () => {
    const result = expandAbbreviations('dc synthesis error');
    assert.ok(result.expanded.includes('Design Compiler'));
    assert.equal(result.abbreviations.length, 1);
    assert.equal(result.abbreviations[0].abbr, 'dc');
  });

  it('expands multiple abbreviations', () => {
    const result = expandAbbreviations('dc vs pt timing');
    assert.ok(result.expanded.includes('Design Compiler'));
    assert.ok(result.expanded.includes('PrimeTime'));
    assert.ok(result.abbreviations.length >= 2);
  });

  it('leaves non-abbreviated words unchanged', () => {
    const result = expandAbbreviations('hello world');
    assert.ok(result.expanded.includes('hello'));
    assert.ok(result.expanded.includes('world'));
    assert.equal(result.abbreviations.length, 0);
  });

  it('handles mixed case', () => {
    const result = expandAbbreviations('DC synthesis');
    assert.ok(result.expanded.includes('Design Compiler'));
  });

  it('handles empty input', () => {
    const result = expandAbbreviations('');
    assert.equal(result.expanded, '');
    assert.equal(result.abbreviations.length, 0);
  });
});

// ── lookupAbbreviation ─────────────────────────────────────────────────

describe('lookupAbbreviation', () => {
  it('finds known abbreviation', () => {
    const result = lookupAbbreviation('dc');
    assert.ok(result);
    assert.equal(result.full, 'Design Compiler');
    assert.equal(result.vendor, 'Synopsys');
  });

  it('returns null for unknown abbreviation', () => {
    const result = lookupAbbreviation('xyznotreal');
    assert.equal(result, null);
  });

  it('is case-insensitive', () => {
    const result = lookupAbbreviation('DC');
    assert.ok(result);
    assert.equal(result.full, 'Design Compiler');
  });
});
