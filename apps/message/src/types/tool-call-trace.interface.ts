export interface IToolCallTrace {
  tool: string;
  status: 'success' | 'error';
  resultPreview?: string;
}
