/** Chặn/tái dùng tool call lặp lại trong CÙNG 1 lượt chạy — tách khỏi
 * ReactLoopRun để test được trực tiếp thay vì chỉ suy ra qua số lần gọi mock. */
export class ToolRepeatGuard {
  private readonly attempts = new Map<string, number>();
  private readonly successCache = new Map<
    string,
    { resultPreview: string; feedText: string }
  >();

  recordAttempt(signature: string): number {
    const attempts = (this.attempts.get(signature) ?? 0) + 1;
    this.attempts.set(signature, attempts);
    return attempts;
  }

  getCachedSuccess(
    signature: string,
  ): { resultPreview: string; feedText: string } | undefined {
    return this.successCache.get(signature);
  }

  cacheSuccess(
    signature: string,
    resultPreview: string,
    feedText: string,
  ): void {
    this.successCache.set(signature, { resultPreview, feedText });
  }
}
