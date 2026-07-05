import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, raw, dataTable, selectOptions, emptyState } from './ui.js';

test('escapeHtml escapes all five metacharacters and stringifies nullish', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')" & more>`),
    '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot; &amp; more&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(7), '7');
});

test('dataTable escapes cell values by default (attack fixture)', () => {
  const html = dataTable({
    columns: [{ label: 'Name', render: (r) => r.name }],
    rows: [{ name: '<img src=x onerror=alert(1)>' }],
  });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('dataTable lets raw() HTML through deliberately', () => {
  const html = dataTable({
    columns: [{ label: '', render: (r) => raw(`<button data-delete="${r.id}">X</button>`) }],
    rows: [{ id: 'abc' }],
  });
  assert.ok(html.includes('<button data-delete="abc">X</button>'));
});

test('dataTable escapes column labels and renders emptyText for zero rows', () => {
  const html = dataTable({ columns: [{ label: '<b>N</b>', render: (r) => r.n }], rows: [] , emptyText: 'Nix'});
  assert.ok(html.includes('Nix'));
  const withRows = dataTable({ columns: [{ label: '<b>N</b>', render: (r) => r.n }], rows: [{ n: 1 }] });
  assert.ok(withRows.includes('&lt;b&gt;N&lt;/b&gt;'));
});

test('selectOptions escapes values/labels and marks the selected item', () => {
  const html = selectOptions(
    [{ id: 'a"b', name: '<Team>' }, { id: 'c', name: 'C' }],
    (t) => t.id, (t) => t.name, 'c');
  assert.ok(html.includes('value="a&quot;b"'));
  assert.ok(html.includes('&lt;Team&gt;'));
  assert.ok(html.includes('<option value="c" selected>C</option>'));
});

test('emptyState escapes its text', () => {
  assert.ok(emptyState('<x>').includes('&lt;x&gt;'));
});
