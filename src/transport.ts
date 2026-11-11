import { KelopsError } from './errors'
import { serialize } from './serialize'
import type { ApiError, LogEntry, SendResult } from './types'

export const DEFAULT_URL = 'https://ingest.kelops.dev'

const TELEMETRY_PATH = '/api/v1/telemetry'

export interface TransportOptions {
  url: string
  apiKey: string
  projectId?: string
  timeoutMs: number
  fetch: typeof fetch
}

function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError'
}

function toApiError(value: unknown): ApiError | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { code, message } = value as Record<string, unknown>
  if (typeof code !== 'string' || typeof message !== 'string') {
    return undefined
  }
  return { code, message }
}

function toCount(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json()
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function buildBody(options: TransportOptions, logs: LogEntry[]): string {
  try {
    return serialize({ project_id: options.projectId, logs })
  } catch (error) {
    throw new KelopsError('SERIALIZATION_FAILED', 'Could not serialize logs to JSON', { cause: error })
  }
}

export async function post(options: TransportOptions, logs: LogEntry[]): Promise<SendResult> {
  const body = buildBody(options, logs)

  let response: Response
  try {
    response = await options.fetch(options.url + TELEMETRY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    if (isTimeout(error)) {
      throw new KelopsError('TIMEOUT', `Request timed out after ${options.timeoutMs} ms`, { cause: error })
    }
    throw new KelopsError('NETWORK', 'Network request failed', { cause: error })
  }

  const data = await readBody(response)

  if (response.ok) {
    return {
      accepted: toCount(data.accepted),
      rejected: toCount(data.rejected),
      error: toApiError(data.error),
    }
  }

  const apiError = toApiError(data.error)
  throw new KelopsError(
    apiError?.code ?? `HTTP_${response.status}`,
    apiError?.message ?? (response.statusText || 'Request failed'),
    {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    },
  )
}
