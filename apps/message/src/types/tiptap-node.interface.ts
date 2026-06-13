export interface ITipTapNode {
  type?: string;
  marks?: Array<{ type: string; attrs?: { href?: string } }>;
  text?: string;
  content?: ITipTapNode[];
}
