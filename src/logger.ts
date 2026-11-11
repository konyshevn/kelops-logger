import { LogBuffer } from './buffer'
import { KelopsClient } from './client'
import { KelopsError, toKelopsError } from './errors'
import { captureUncaught } from './uncaught'
import type { LogContext, LogEntry, LoggerOptions, LogInput } from './types'

export class KelopsLogger {
  private readonly client: KelopsClient
  private readonly service: string
  private readonly onError: (error: KelopsError) => void
  private readonly buffer?: LogBuffer
  private readonly stopCapturing?: () => void
  private readonly pending = new Set<Promise<void>>()
  private closed = false

  constructor(options: LoggerOptions) {
    if (!options.service) {
      throw new TypeError('service is required')
    }
    this.client = new KelopsClient(options)
    this.service = options.service
    this.onError = options.onError ?? (() => undefined)
    if (options.buffer) {
      this.buffer = new LogBuffer((logs) => this.deliver(logs), (error) => this.report(error), options.buffer)
    }
    if (options.captureUncaught) {
      const capture = options.captureUncaught === true ? {} : options.captureUncaught
      this.stopCapturing = captureUncaught({
        ...capture,
        report: (message, context) => this.error(message, context),
        flush: () => this.flush(),
      })
    }
  }

  debug(message: string, context?: LogContext): Promise<void> {
    return this.log({ level: 'debug', message, context })
  }

  info(message: string, context?: LogContext): Promise<void> {
    return this.log({ level: 'info', message, context })
  }

  warn(message: string, context?: LogContext): Promise<void> {
    return this.log({ level: 'warn', message, context })
  }

  error(message: string, context?: LogContext): Promise<void> {
    return this.log({ level: 'error', message, context })
  }

  log(input: LogInput): Promise<void> {
    if (this.closed) {
      this.report(new KelopsError('CLOSED', 'Logger is closed'))
      return Promise.resolve()
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: input.level,
      service: input.service ?? this.service,
      message: input.message,
    }
    if (input.context !== undefined) {
      entry.context = input.context
    }

    if (this.buffer) {
      this.buffer.add(entry)
      return Promise.resolve()
    }
    return this.deliver([entry])
  }

  async flush(): Promise<void> {
    await this.buffer?.flush()
    await Promise.all([...this.pending])
  }

  async close(): Promise<void> {
    this.stopCapturing?.()
    this.closed = true
    await this.flush()
  }

  private deliver(logs: LogEntry[]): Promise<void> {
    const promise = this.send(logs)
    this.pending.add(promise)
    void promise.finally(() => this.pending.delete(promise))
    return promise
  }

  private async send(logs: LogEntry[]): Promise<void> {
    try {
      const result = await this.client.send(logs)
      if (result.rejected > 0 && result.error) {
        this.report(new KelopsError(result.error.code, result.error.message))
      }
    } catch (error) {
      this.report(toKelopsError(error))
    }
  }

  private report(error: KelopsError): void {
    try {
      this.onError(error)
    } catch {
      return
    }
  }
}
