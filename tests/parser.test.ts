import { describe, expect, it } from 'vitest';
import { detectDelimiter, findTypeMismatchedColumns, parseCSV, parseJSON, serializeCSV, serializeJSON } from '../src/core/parser.ts';

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

  it('treats a top-level object as a one-row table', () => {
    const { headers, rows } = parseJSON('{"a":1,"b":"x"}');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', 'x']]);
  });

  it('flattens a top-level object the same way it flattens array records', () => {
    const { headers, rows } = parseJSON('{"id":1,"company":{"name":"Acme"}}');
    expect(headers).toEqual(['id', 'company.name']);
    expect(rows).toEqual([['1', 'Acme']]);
  });

  it('throws a friendly error on a top-level primitive (number/string/bool/null)', () => {
    expect(() => parseJSON('42')).toThrow('JSON must be an array of objects, an array of arrays, or a single object.');
    expect(() => parseJSON('"hello"')).toThrow();
    expect(() => parseJSON('null')).toThrow();
  });

  it('throws a friendly error on malformed JSON instead of the raw SyntaxError', () => {
    expect(() => parseJSON('{"a":')).toThrow("This file isn't valid JSON — check for a missing bracket, quote, or trailing comma.");
  });

  it('returns empty table for an empty array', () => {
    expect(parseJSON('[]')).toEqual({ headers: [], rows: [], columnTypes: {} });
  });

  it('returns empty table for an empty or whitespace-only file', () => {
    expect(parseJSON('')).toEqual({ headers: [], rows: [], columnTypes: {} });
    expect(parseJSON('   \n  ')).toEqual({ headers: [], rows: [], columnTypes: {} });
  });

  it('flattens nested objects into dot-delimited keys', () => {
    const { headers, rows } = parseJSON('[{"id":1,"company":{"name":"Acme","hq":{"city":"NY"}}}]');
    expect(headers).toEqual(['id', 'company.name', 'company.hq.city']);
    expect(rows).toEqual([['1', 'Acme', 'NY']]);
  });

  it('flattens array values using their index as the path segment', () => {
    const { headers, rows } = parseJSON('[{"images":[{"url":"a"},{"url":"b"}]}]');
    expect(headers).toEqual(['images.0.url', 'images.1.url']);
    expect(rows).toEqual([['a', 'b']]);
  });

  it('keeps empty objects/arrays as a stringified leaf, not flattened away', () => {
    const { headers, rows } = parseJSON('[{"tags":[],"meta":{}}]');
    expect(headers).toEqual(['tags', 'meta']);
    expect(rows).toEqual([['[]', '{}']]);
  });

  it('profiles each column\'s type from the closest non-null value, not just the first row', () => {
    const { columnTypes } = parseJSON(
      '[{"price":null,"active":true},{"price":9.5,"active":null},{"price":"n/a","active":false}]',
    );
    expect(columnTypes).toEqual({ price: 'number', active: 'boolean' });
  });

  it('defaults a column to text when every value is a string, or every row is null', () => {
    const { columnTypes } = parseJSON('[{"name":"a","note":null},{"name":"b","note":null}]');
    expect(columnTypes).toEqual({ name: 'text' });
  });

  it('does not profile types for array-of-arrays input (no keys to type)', () => {
    expect(parseJSON('[["a","b"],[1,2]]').columnTypes).toEqual({});
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
    expect(parseJSON(text)).toEqual({ headers, rows, columnTypes: { a: 'text', b: 'text' } });
  });

  it('exports profiled number/boolean columns as their real JSON type', () => {
    const text = serializeJSON(['price', 'active', 'name'], [['9.5', 'true', 'Acme']], {
      price: 'number',
      active: 'boolean',
      name: 'text',
    });
    expect(JSON.parse(text)).toEqual([{ price: 9.5, active: true, name: 'Acme' }]);
  });

  it('exports an empty cell as null for typed columns but "" for text columns', () => {
    const text = serializeJSON(['price', 'name'], [['', '']], { price: 'number' });
    expect(JSON.parse(text)).toEqual([{ price: null, name: '' }]);
  });

  it('falls back to the raw string when a typed cell no longer parses as its type', () => {
    const text = serializeJSON(['price'], [['not-a-number']], { price: 'number' });
    expect(JSON.parse(text)).toEqual([{ price: 'not-a-number' }]);
  });

  it('round-trips a nested object through parseJSON -> edit -> serializeJSON, rebuilding the nested shape', () => {
    const original = '[{"company":{"name":"Acme","founded":1994}}]';
    const { headers, rows, columnTypes } = parseJSON(original);
    const text = serializeJSON(headers, rows, columnTypes);
    expect(JSON.parse(text)).toEqual([{ company: { name: 'Acme', founded: 1994 } }]);
  });

  it('rebuilds a flattened array-of-objects field back into an array', () => {
    const original = '[{"images":[{"url":"a"},{"url":"b"}]}]';
    const { headers, rows, columnTypes } = parseJSON(original);
    const text = serializeJSON(headers, rows, columnTypes);
    expect(JSON.parse(text)).toEqual([{ images: [{ url: 'a' }, { url: 'b' }] }]);
  });

  it('rebuilds a 3-level-deep nested path', () => {
    const original = '[{"company":{"hq":{"city":"NY"}}}]';
    const { headers, rows, columnTypes } = parseJSON(original);
    const text = serializeJSON(headers, rows, columnTypes);
    expect(JSON.parse(text)).toEqual([{ company: { hq: { city: 'NY' } } }]);
  });

  it('never turns the record itself into an array, even if every header looks like an index', () => {
    const text = serializeJSON(['0', '1'], [['a', 'b']]);
    expect(JSON.parse(text)).toEqual([{ '0': 'a', '1': 'b' }]);
  });

  it('leaves an un-dotted header as a plain top-level key', () => {
    const text = serializeJSON(['sku', 'price'], [['A1', '9.5']], { price: 'number' });
    expect(JSON.parse(text)).toEqual([{ sku: 'A1', price: 9.5 }]);
  });
});

describe('findTypeMismatchedColumns', () => {
  it('flags a number column with a non-numeric cell', () => {
    const headers = ['price'];
    const rows = [['9.5'], ['not-a-number']];
    expect(findTypeMismatchedColumns(headers, rows, { price: 'number' })).toEqual(['price']);
  });

  it('flags a boolean column with a value other than "true"/"false"', () => {
    const headers = ['active'];
    const rows = [['true'], ['maybe']];
    expect(findTypeMismatchedColumns(headers, rows, { active: 'boolean' })).toEqual(['active']);
  });

  it('does not flag empty cells on a typed column', () => {
    const headers = ['price'];
    const rows = [['9.5'], ['']];
    expect(findTypeMismatchedColumns(headers, rows, { price: 'number' })).toEqual([]);
  });

  it('never flags text columns, even with wildly varied content', () => {
    const headers = ['name'];
    const rows = [['Acme'], ['42'], ['true'], ['']];
    expect(findTypeMismatchedColumns(headers, rows, { name: 'text' })).toEqual([]);
  });

  it('never flags a column with no columnTypes entry (implicit text)', () => {
    const headers = ['note'];
    const rows = [['n/a'], ['whatever']];
    expect(findTypeMismatchedColumns(headers, rows, {})).toEqual([]);
    expect(findTypeMismatchedColumns(headers, rows)).toEqual([]);
  });

  it('returns every mismatched column, not just the first', () => {
    const headers = ['price', 'active', 'name'];
    const rows = [['n/a', 'nope', 'Acme']];
    expect(findTypeMismatchedColumns(headers, rows, { price: 'number', active: 'boolean', name: 'text' })).toEqual([
      'price',
      'active',
    ]);
  });
});
