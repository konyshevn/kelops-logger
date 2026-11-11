import { KelopsError } from './errors'
import type { BufferOptions, LogEntry } from './types'

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_MAX_QUEUE = 10_000

type Sink = (logs: LogEntry[]) => Promise<void>

export class LogBuffer {
  private queue: LogEntry[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private sending: Promise<void> | undefined
  private dropped = 0
  private readonly batchSize: number
  private readonly intervalMs: number
  private readonly maxQueue: number

  constructor(
    private readonly sink: Sink,
    private readonly onError: (error: KelopsError) => void,
    options: BufferOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE
  }

  add(entry: LogEntry): void {
    this.queue.push(entry)
    if (this.queue.length > this.maxQueue) {
      const excess = this.queue.length - this.maxQueue
      this.queue.splice(0, excess)
      this.dropped += excess
    }
    this.trigger()
  }

  async flush(): Promise<void> {
    while (this.sending) {
      await this.sending
    }
    this.clearTimer()
    this.reportDropped()
    if (this.queue.length === 0) {
      return
    }

    const logs = this.queue
    this.queue = []
    const sending = this.sink(logs)
    this.sending = sending
    try {
      await sending
    } finally {
      this.sending = undefined
      this.trigger()
    }
  }

  private trigger(): void {
    if (this.sending || this.queue.length === 0) {
      return
    }
    if (this.queue.length >= this.batchSize) {
      void this.flush()
      return
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.intervalMs)
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private reportDropped(): void {
    if (this.dropped === 0) {
      return
    }
    const count = this.dropped
    this.dropped = 0
    this.onError(new KelopsError('QUEUE_OVERFLOW', `Dropped ${count} oldest log entries because the queue is full`))
  }
}
