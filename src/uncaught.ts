import type { CaptureUncaughtOptions, LogContext } from './types'

export type ProcessLike = Pick<NodeJS.Process, 'on' | 'off' | 'listenerCount' | 'exit'>

interface CaptureHooks extends CaptureUncaughtOptions {
  report: (message: string, context: LogContext) => Promise<void>
  flush: () => Promise<void>
  target?: ProcessLike
}

type CaptureEvent = 'uncaughtException' | 'unhandledRejection'

const DEFAULT_FLUSH_TIMEOUT_MS = 3000

let active = false

function describeReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function waitUpTo(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}

export function captureUncaught(hooks: CaptureHooks): () => void {
  if (active) {
    throw new Error('captureUncaught is already enabled for another logger')
  }

  const target = hooks.target ?? process
  const flushTimeoutMs = hooks.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS

  const handle = async (event: CaptureEvent, message: string, context: LogContext): Promise<void> => {
    const hasOtherListeners = target.listenerCount(event) > 1
    await waitUpTo(hooks.report(message, context).then(hooks.flush), flushTimeoutMs)
    if (!hasOtherListeners) {
      target.exit(1)
    }
  }

  const onException = (error: Error, origin: string): void => {
    void handle('uncaughtException', `Uncaught exception: ${describeReason(error)}`, { error, origin })
  }

  const onRejection = (reason: unknown): void => {
    void handle('unhandledRejection', `Unhandled promise rejection: ${describeReason(reason)}`, { error: reason })
  }

  target.on('uncaughtException', onException)
  target.on('unhandledRejection', onRejection)
  active = true

  let removed = false
  return () => {
    if (removed) {
      return
    }
    removed = true
    target.off('uncaughtException', onException)
    target.off('unhandledRejection', onRejection)
    active = false
  }
}
