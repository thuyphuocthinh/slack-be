import { createHash, timingSafeEqual } from 'crypto';

function resolveSecrets(): Record<string, string> {
  const raw = process.env.EDGE_RELAY_SECRETS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isValidRelaySecret(
  workspaceId: string | undefined,
  token: string | undefined,
): boolean {
  if (!workspaceId || !token) return false;
  const expected = resolveSecrets()[workspaceId];
  if (!expected) return false;
  return timingSafeEqual(hash(expected), hash(token));
}
