import { createHash, timingSafeEqual } from 'crypto';

// Placeholder dùng khi workspaceId không tồn tại, để luôn chạy đủ hash+compare
// (constant-time) — tránh lộ qua thời gian phản hồi việc 1 workspaceId có được
// cấu hình hay không trước cả khi biết secret đúng/sai.
const DUMMY_SECRET = 'edge-relay-dummy-secret-constant-time-placeholder';

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

  const secrets = resolveSecrets();
  const exists = Object.prototype.hasOwnProperty.call(secrets, workspaceId);
  const expected = exists ? secrets[workspaceId] : DUMMY_SECRET;
  const matches = timingSafeEqual(hash(expected), hash(token));

  return exists && matches;
}
