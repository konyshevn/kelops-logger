import { toKelopsError, type KelopsError } from './errors'
import { defaultRetry, withRetry } from './retry'
import { DEFAULT_URL, post, type TransportOptions } from './transport'
import type { ClientOptions, LogEntry, RetryOptions, SendResult } from './types'

const MAX_ITEMS_PER_REQUEST = 2000
const DEFAULT_TIMEOUT_MS = 10_000

function splitIntoParts<T>(items: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    parts.push(items.slice(start, start + size))
  }
  return parts
}

export class KelopsClient {
  private readonly transport: TransportOptions
  private readonly retry: RetryOptions

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new TypeError('apiKey is required')
    }
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetch is not available, use Node.js 18 or newer')
    }
    this.transport = {
      url: DEFAULT_URL,
      apiKey: options.apiKey,
      projectId: options.projectId,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetch: fetchImpl,
    }
    this.retry = { ...defaultRetry, ...options.retry }
  }

  async send(logs: LogEntry[]): Promise<SendResult> {
    const total: SendResult = { accepted: 0, rejected: 0 }
    let failure: KelopsError | undefined

    for (const part of splitIntoParts(logs, MAX_ITEMS_PER_REQUEST)) {
      try {
        const result = await withRetry(() => post(this.transport, part), this.retry)
        total.accepted += result.accepted
        total.rejected += result.rejected
        total.error ??= result.error
      } catch (error) {
        failure ??= toKelopsError(error)
      }
    }

    if (failure) {
      throw failure
    }
    return total
  }
}
