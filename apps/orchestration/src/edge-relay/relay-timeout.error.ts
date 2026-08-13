export class RelayTimeoutError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly cause?: Error,
  ) {
    super(`Edge relay timed out for workspace ${workspaceId}`);
    this.name = 'RelayTimeoutError';
  }
}
