export class RelayOfflineError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Edge relay offline for workspace ${workspaceId}`);
    this.name = 'RelayOfflineError';
  }
}
