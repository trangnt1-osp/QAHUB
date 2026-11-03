type TextNode = { type: string; text?: string; content?: TextNode[]; marks?: unknown[] };
export type PreconditionsDocument = { type: 'doc'; content: TextNode[] };
function validNode(node: unknown, depth = 0): node is TextNode {
  if (!node || typeof node !== 'object' || depth > 100) return false;
  const value = node as TextNode;
  return typeof value.type === 'string' && (value.text === undefined || typeof value.text === 'string')
    && (value.marks === undefined || Array.isArray(value.marks))
    && (value.content === undefined || Array.isArray(value.content) && value.content.every(child => validNode(child, depth + 1)));
}
function storedDocument(value?: string | null): PreconditionsDocument | null {
  if (!value?.startsWith('{')) return null;
  try {
    const doc = JSON.parse(value);
    return doc?.type === 'doc' && Array.isArray(doc.content) && validNode(doc) ? doc as PreconditionsDocument : null;
  } catch { return null; }
}
export function preconditionsDocument(value?: string | null): PreconditionsDocument {
  return storedDocument(value) ?? { type: 'doc', content: (value ?? '').split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) };
}
function nodeText(node: TextNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(nodeText).join(['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type) ? '\n' : '');
}
export function preconditionsText(value?: string | null): string {
  const doc = storedDocument(value);
  return doc ? nodeText(doc) : value ?? '';
}
export function serializePreconditions(doc: PreconditionsDocument): string {
  const plain = doc.content.every(node => node.type === 'paragraph' && (node.content ?? []).every(child => child.type === 'text' && !child.marks?.length || child.type === 'hardBreak'));
  return plain ? nodeText(doc) : JSON.stringify(doc);
}
