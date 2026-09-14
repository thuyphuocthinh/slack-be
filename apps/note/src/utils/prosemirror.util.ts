interface ProseMirrorNodeLike {
  content?: ProseMirrorNodeLike[];
  text?: string;
}

// Đệ quy gom hết field `text` trong 1 node ProseMirror (và mọi content con lồng
// nhau) thành 1 chuỗi phẳng — dùng để index full-text search trên Blocks.content,
// vì content là JSONB lồng sâu (paragraph -> content[] -> text run -> text),
// không thể to_tsvector trực tiếp trên JSONB như đã làm với pages.title.
export function extractPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const { text, content } = node as ProseMirrorNodeLike;
  const parts: string[] = [];

  if (typeof text === 'string') parts.push(text);

  if (Array.isArray(content)) {
    for (const child of content) {
      const childText = extractPlainText(child);
      if (childText) parts.push(childText);
    }
  }

  return parts.join(' ');
}
