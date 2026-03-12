import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentWeekId, hmacSign, hmacVerify } from '../utils';

// ── getCurrentWeekId ──────────────────────────────────────────────────────────
// Logic: returns Unix seconds of the most recent Friday at 00:00:00 UTC.
// Formula: daysSinceFriday = (utcDay + 2) % 7, where Fri=0, Sat=1 … Thu=6.

describe('getCurrentWeekId', () => {
  afterEach(() => vi.useRealTimers());

  it('returns a number (Unix seconds)', () => {
    const id = getCurrentWeekId();
    expect(typeof id).toBe('number');
    // Sanity: should be well past the epoch and not in milliseconds
    expect(id).toBeGreaterThan(1_700_000_000);
    expect(id).toBeLessThan(10_000_000_000);
  });

  it('on a Friday returns that same day at 00:00:00 UTC', () => {
    // 2025-03-07 is a Friday
    vi.setSystemTime(new Date('2025-03-07T15:30:00Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-07T00:00:00Z').getTime() / 1000));
  });

  it('on a Saturday returns the previous Friday at 00:00:00 UTC', () => {
    vi.setSystemTime(new Date('2025-03-08T09:00:00Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-07T00:00:00Z').getTime() / 1000));
  });

  it('on a Sunday returns the most recent Friday', () => {
    vi.setSystemTime(new Date('2025-03-09T00:00:00Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-07T00:00:00Z').getTime() / 1000));
  });

  it('on a Monday returns the most recent Friday', () => {
    vi.setSystemTime(new Date('2025-03-10T18:00:00Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-07T00:00:00Z').getTime() / 1000));
  });

  it('on a Thursday (day before reset) returns the same week\'s Friday', () => {
    vi.setSystemTime(new Date('2025-03-13T23:59:59Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-07T00:00:00Z').getTime() / 1000));
  });

  it('on the next Friday returns a new, larger week ID', () => {
    vi.setSystemTime(new Date('2025-03-14T00:00:00Z'));
    const id = getCurrentWeekId();
    expect(id).toBe(Math.floor(new Date('2025-03-14T00:00:00Z').getTime() / 1000));
  });

  it('consecutive weeks differ by exactly 7 days (604800 seconds)', () => {
    vi.setSystemTime(new Date('2025-03-07T00:00:00Z'));
    const week1 = getCurrentWeekId();
    vi.setSystemTime(new Date('2025-03-14T00:00:00Z'));
    const week2 = getCurrentWeekId();
    expect(week2 - week1).toBe(7 * 24 * 3600);
  });

  it('returns seconds, not milliseconds (value fits in 32-bit integer range)', () => {
    const id = getCurrentWeekId();
    expect(id).toBeLessThan(2 ** 32);
  });
});

// ── hmacSign ──────────────────────────────────────────────────────────────────

describe('hmacSign', () => {
  it('returns a non-empty string', async () => {
    const token = await hmacSign('secret', 'message');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('is deterministic — same inputs always produce the same token', async () => {
    const a = await hmacSign('my-secret', 'game1:player1:12345');
    const b = await hmacSign('my-secret', 'game1:player1:12345');
    expect(a).toBe(b);
  });

  it('produces different tokens for different messages', async () => {
    const a = await hmacSign('secret', 'game1:player1:100');
    const b = await hmacSign('secret', 'game1:player1:101');
    expect(a).not.toBe(b);
  });

  it('produces different tokens for different secrets', async () => {
    const a = await hmacSign('secret-A', 'message');
    const b = await hmacSign('secret-B', 'message');
    expect(a).not.toBe(b);
  });

  it('returns URL-safe base64 (no +, /, or = characters)', async () => {
    // Run multiple times to get different bit patterns
    for (let i = 0; i < 10; i++) {
      const token = await hmacSign(`secret-${i}`, `message-${i}`);
      expect(token).not.toMatch(/[+/=]/);
    }
  });
});

// ── hmacVerify ────────────────────────────────────────────────────────────────

describe('hmacVerify', () => {
  it('returns true for a token produced by hmacSign with the same inputs', async () => {
    const token = await hmacSign('my-secret', 'game1:player1:9999');
    expect(await hmacVerify('my-secret', 'game1:player1:9999', token)).toBe(true);
  });

  it('returns false for a token with a tampered character', async () => {
    const token = await hmacSign('my-secret', 'message');
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
    expect(await hmacVerify('my-secret', 'message', tampered)).toBe(false);
  });

  it('returns false when the message differs', async () => {
    const token = await hmacSign('my-secret', 'game1:player1:10');
    expect(await hmacVerify('my-secret', 'game1:player1:11', token)).toBe(false);
  });

  it('returns false when the secret differs', async () => {
    const token = await hmacSign('correct-secret', 'message');
    expect(await hmacVerify('wrong-secret', 'message', token)).toBe(false);
  });

  it('returns false for an empty token string', async () => {
    expect(await hmacVerify('secret', 'message', '')).toBe(false);
  });

  it('returns false for a random garbage token', async () => {
    expect(await hmacVerify('secret', 'message', 'notavalidtoken')).toBe(false);
  });

  // ── Session window tolerance (mirrors POST /score logic) ──────────────────
  // The worker accepts tokens from the current AND previous 180-second window.
  // This test verifies that hmacSign/hmacVerify compose correctly for that pattern.

  it('session window: token from previous window is accepted when checked against tw-1', async () => {
    const secret = 'session-secret';
    const gameId = 1;
    const playerId = 'player-abc';
    const tw = Math.floor(Date.now() / 180000);

    // Token issued in the previous window
    const oldToken = await hmacSign(secret, `${gameId}:${playerId}:${tw - 1}`);

    // Worker checks both tw and tw-1 — the previous window token should match tw-1
    const matchesCurrent  = await hmacVerify(secret, `${gameId}:${playerId}:${tw}`,     oldToken);
    const matchesPrevious = await hmacVerify(secret, `${gameId}:${playerId}:${tw - 1}`, oldToken);

    expect(matchesCurrent).toBe(false);
    expect(matchesPrevious).toBe(true);
  });

  it('session window: token from 2 windows ago is rejected', async () => {
    const secret = 'session-secret';
    const tw = Math.floor(Date.now() / 180000);

    const staleToken = await hmacSign(secret, `1:player:${tw - 2}`);

    const matchesCurrent  = await hmacVerify(secret, `1:player:${tw}`,     staleToken);
    const matchesPrevious = await hmacVerify(secret, `1:player:${tw - 1}`, staleToken);

    expect(matchesCurrent).toBe(false);
    expect(matchesPrevious).toBe(false);
  });
});
