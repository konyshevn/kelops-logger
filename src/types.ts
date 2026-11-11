import type { KelopsError } from './errors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

export interface LogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  trace_id?: string
  span_id?: string
  context?: LogContext
}

export interface ApiError {
  code: string
  message: string
}

export interface SendResult {
  accepted: number
  rejected: number
  error?: ApiError
}

export interface RetryOptions {
  attempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface ClientOptions {
  apiKey: string
  projectId?: string
  timeoutMs?: number
  retry?: Partial<RetryOptions>
  fetch?: typeof fetch
}

export interface BufferOptions {
  batchSize?: number
  intervalMs?: number
  maxQueue?: number
}

export interface CaptureUncaughtOptions {
  flushTimeoutMs?: number
}

export interface LoggerOptions extends ClientOptions {
  service: string
  buffer?: BufferOptions
  captureUncaught?: boolean | CaptureUncaughtOptions
  onError?: (error: KelopsError) => void
}

export interface LogInput {
  level: LogLevel
  message: string
  service?: string
  context?: LogContext
}
