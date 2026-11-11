import { describe, expect, it, vi } from 'vitest'
import { KelopsError } from '../src/errors'
import { computeDelay, isRetryable, withRetry } from '../src/retry'

const options = { attempts: 3, baseDelayMs: 500, maxDelayMs: 30_000 }

describe('isRetryable', () => {
  it.each([
    ['NETWORK', undefined, true],
    ['TIMEOUT', undefined, true],
    ['RATE_LIMITED', 429, true],
    ['OVERLOADED', 503, true],
    ['INTERNAL_ERROR', 500, true],
    ['HTTP_502', 502, true],
    ['INVALID_API_KEY', 401, false],
    ['PROJECT_FORBIDDEN', 403, false],
    ['VALIDATION_FAILED', 400, false],
    ['SERIALIZATION_FAILED', undefined, false],
  ])('%s with status %s is %s', (code, status, expected) => {
    expect(isRetryable(new KelopsError(code, 'message', { status }))).toBe(expected)
  })
})

describe('computeDelay', () => {
  it('doubles the delay with every attempt', () => {
    const error = new KelopsError('NETWORK', 'failed')
    expect(computeDelay(1, error, options, () => 0)).toBe(500)
    expect(computeDelay(2, error, options, () => 0)).toBe(1000)
    expect(computeDelay(3, error, options, () => 0)).toBe(2000)
  })

  it('adds jitter of up to 20 percent', () => {
    const error = new KelopsError('NETWORK', 'failed')
    expect(computeDelay(1, error, options, () => 1)).toBe(600)
  })

  it('does not exceed the maximum delay', () => {
    const error = new KelopsError('NETWORK', 'failed')
    expect(computeDelay(20, error, options, () => 0)).toBe(30_000)
  })

  it('prefers Retry-After but still respects the maximum', () => {
    const short = new KelopsError('RATE_LIMITED', 'limited', { status: 429, retryAfterMs: 1500 })
    const long = new KelopsError('RATE_LIMITED', 'limited', { status: 429, retryAfterMs: 120_000 })
    expect(computeDelay(1, short, options, () => 0)).toBe(1500)
    expect(computeDelay(1, long, options, () => 0)).toBe(30_000)
  })
})

describe('withRetry', () => {
  it('retries until the call succeeds', async () => {
    const sleep = vi.fn(async () => undefined)
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new KelopsError('NETWORK', 'failed'))
      .mockRejectedValueOnce(new KelopsError('OVERLOADED', 'busy', { status: 503 }))
      .mockResolvedValueOnce('done')

    expect(await withRetry(run, options, sleep)).toBe('done')
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('stops after the configured number of attempts', async () => {
    const error = new KelopsError('NETWORK', 'failed')
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(error)

    await expect(withRetry(run, options, async () => undefined)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('does not retry client errors', async () => {
    const error = new KelopsError('INVALID_API_KEY', 'Invalid API key', { status: 401 })
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(error)
    const sleep = vi.fn(async () => undefined)

    await expect(withRetry(run, options, sleep)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry unknown errors', async () => {
    const error = new Error('unexpected')
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(error)

    await expect(withRetry(run, options, async () => undefined)).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('waits for the time given by the server', async () => {
    const sleep = vi.fn(async () => undefined)
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new KelopsError('RATE_LIMITED', 'limited', { status: 429, retryAfterMs: 1200 }))
      .mockResolvedValueOnce('done')

    await withRetry(run, options, sleep)
    expect(sleep).toHaveBeenCalledWith(1200)
  })
})
