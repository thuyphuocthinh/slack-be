export interface McpContentPart {
  type: string;
  text?: string;
}

export function extractTextFromMcpResult(result?: { content?: McpContentPart[] }): string {
  if (!result?.content?.length) return '';
  return result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
}
