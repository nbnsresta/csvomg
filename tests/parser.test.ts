import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCSV, parseJSON, serializeCSV, serializeJSON } from '../src/core/parser.ts';

describe('parseCSV', () => {
  it('parses a simple comma-delimited table', () => {
    const { headers, rows } = parseCSV('a,b,c\n1,2,3\n4,5,6');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields containing the delimiter', () => {
    const { headers, rows } = parseCSV('name,note\n"Doe, John","says ""hi"""');
    expect(headers).toEqual(['name', 'note']);
    expect(rows).toEqual([['Doe, John', 'says "hi"']]);
  });

  it('handles embedded newlines inside quoted fields', () => {
    const { rows } = parseCSV('a,b\n"line1\nline2",x');
    expect(rows).toEqual([['line1\nline2', 'x']]);
  });

  it('handles CRLF line endings', () => {
    const { headers, rows } = parseCSV('a,b\r\n1,2\r\n3,4');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('ignores a trailing newline at end of file', () => {
    const { rows } = parseCSV('a,b\n1,2\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('pads ragged rows out to the header length', () => {
    const { rows } = parseCSV('a,b,c\n1,2');
    expect(rows).toEqual([['1', '2', '']]);
  });

  it('returns empty headers/rows for empty input', () => {
    expect(parseCSV('')).toEqual({ headers: [], rows: [], delimiter: ',' });
  });

  it('auto-detects a tab delimiter', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('auto-detects a semicolon delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('respects an explicit delimiter override', () => {
    const { headers } = parseCSV('a|b|c\n1|2|3', '|');
    expect(headers).toEqual(['a', 'b', 'c']);
  });
});

describe('serializeCSV', () => {
  it('round-trips through parseCSV', () => {
    const headers = ['a', 'b'];
    const rows = [
      ['1', '2'],
      ['3', '4'],
    ];
    const text = serializeCSV(headers, rows);
    expect(parseCSV(text)).toEqual({ headers, rows, delimiter: ',' });
  });

  it('quotes fields containing the delimiter, quotes, or newlines', () => {
    const text = serializeCSV(['name'], [['Doe, "Jr"\nSuffix']]);
    expect(text).toBe('name\r\n"Doe, ""Jr""\nSuffix"');
  });
});

describe('parseJSON', () => {
  it('parses an array of objects, unioning keys in first-seen order', () => {
    const { headers, rows } = parseJSON('[{"a":1,"b":2},{"b":3,"c":4}]');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['1', '2', ''],
      ['', '3', '4'],
    ]);
  });

  it('parses an array of arrays, treating the first row as headers', () => {
    const { headers, rows } = parseJSON('[["a","b"],[1,2],[3,4]]');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('throws on non-array JSON', () => {
    expect(() => parseJSON('{"a":1}')).toThrow();
  });

  it('returns empty table for an empty array', () => {
    expect(parseJSON('[]')).toEqual({ headers: [], rows: [] });
  });
});

describe('serializeJSON', () => {
  it('round-trips through parseJSON', () => {
    const headers = ['a', 'b'];
    const rows = [
      ['1', '2'],
      ['3', '4'],
    ];
    const text = serializeJSON(headers, rows);
    expect(parseJSON(text)).toEqual({ headers, rows });
  });
});
