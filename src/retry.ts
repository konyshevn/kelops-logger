import { KelopsError } from './errors'
import type { RetryOptions } from './types'

export const defaultRetry: RetryOptions = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
}

type Sleep = (ms: number) => Promise<void>

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function isRetryable(error: KelopsError): boolean {
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
    return true
  }
  return error.status === 429 || (error.status !== undefined && error.status >= 500)
}

export function computeDelay(
  attempt: number,
  error: KelopsError,
  options: RetryOptions,
  random: () => number = Math.random,
): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, options.maxDelayMs)
  }
  const exponential = options.baseDelayMs * 2 ** (attempt - 1)
  const jitter = exponential * 0.2 * random()
  return Math.min(exponential + jitter, options.maxDelayMs)
}

export async function withRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions,
  sleep: Sleep = defaultSleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof KelopsError) || !isRetryable(error) || attempt >= options.attempts) {
        throw error
      }
      await sleep(computeDelay(attempt, error, options))
    }
  }
}
