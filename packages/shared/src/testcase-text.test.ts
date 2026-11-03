import { expect, it } from 'vitest';
import { preconditionsDocument, preconditionsText, serializePreconditions } from './testcase-text';

it('preserves legacy plain text including literal HTML and line breaks', () => {
  const text = 'Account <admin>\nActive';
  expect(preconditionsText(text)).toBe(text);
  expect(serializePreconditions(preconditionsDocument(text))).toBe(text);
  expect(preconditionsText('{"type":"doc","content":[null]}')).toBe('{"type":"doc","content":[null]}');
});
it('round trips rich text and exposes readable text to grids and Excel', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Account', marks: [{ type: 'bold' }] }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Active' }] }] }] }] };
  const stored = serializePreconditions(doc);
  expect(preconditionsDocument(stored)).toEqual(doc);
  expect(preconditionsText(stored)).toBe('Account\nActive');
});
