import { describe, expect, test } from "bun:test";
import { getNextJobRetryState } from "../commands/start";

describe("getNextJobRetryState", () => {
  test("pauses job until rate limit reset without consuming retries", () => {
    const state = getNextJobRetryState(
      { retry: 3, retryDelay: 60 },
      { exitCode: 1 },
      { failCount: 1, retryAt: 0 },
      1_000,
      true,
      9_000,
    );

    expect(state).toEqual({ failCount: 1, retryAt: 9_000, rateLimited: true });
  });

  test("schedules normal retry delay on non-rate-limit failures", () => {
    const state = getNextJobRetryState(
      { retry: 3, retryDelay: 120 },
      { exitCode: 1 },
      undefined,
      1_000,
      false,
      0,
    );

    expect(state).toEqual({ failCount: 1, retryAt: 121_000 });
  });

  test("preserves one-time jobs through rate limits even without retry config", () => {
    const state = getNextJobRetryState(
      { retry: undefined, retryDelay: undefined },
      { exitCode: 1 },
      undefined,
      1_000,
      true,
      8_000,
    );

    expect(state).toEqual({ failCount: 0, retryAt: 8_000, rateLimited: true });
  });

  test("returns null after retries are exhausted", () => {
    const state = getNextJobRetryState(
      { retry: 2, retryDelay: 60 },
      { exitCode: 1 },
      { failCount: 2, retryAt: 0 },
      1_000,
      false,
      0,
    );

    expect(state).toBeNull();
  });
});
