/**
 * Retries a callback on PostgreSQL serialization failure (error code 40001).
 * Use when wrapping a SERIALIZABLE transaction that may conflict under concurrent load.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const pgCode = err?.code ?? err?.driverError?.code;
      if (pgCode === '40001' && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}
