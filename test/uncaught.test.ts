import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KelopsLogger } from '../src/logger'
import { captureUncaught, type ProcessLike } from '../src/uncaught'

function fakeProcess() {
  const emitter = new EventEmitter()
  const exit = vi.fn()
  const target = Object.assign(emitter, { exit }) as unknown as ProcessLike
  return { target, emitter, exit }
}

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
})

describe('captureUncaught', () => {
  it('adds and removes its listeners', () => {
    const { target, emitter } = fakeProcess()

    stop = captureUncaught({ report: async () => undefined, flush: async () => undefined, target })
    expect(emitter.listenerCount('uncaughtException')).toBe(1)
    expect(emitter.listenerCount('unhandledRejection')).toBe(1)

    stop()
    expect(emitter.listenerCount('uncaughtException')).toBe(0)
    expect(emitter.listenerCount('unhandledRejection')).toBe(0)
  })

  it('reports an uncaught exception, flushes and exits with code 1', async () => {
    const { target, emitter, exit } = fakeProcess()
    const report = vi.fn(async () => undefined)
    const flush = vi.fn(async () => undefined)
    stop = captureUncaught({ report, flush, target })

    const error = new Error('boom')
    emitter.emit('uncaughtException', error, 'uncaughtException')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(report).toHaveBeenCalledWith('Uncaught exception: boom', { error, origin: 'uncaughtException' })
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('reports an unhandled rejection with a value that is not an error', async () => {
    const { target, emitter, exit } = fakeProcess()
    const report = vi.fn(async () => undefined)
    stop = captureUncaught({ report, flush: async () => undefined, target })

    emitter.emit('unhandledRejection', 'nope', Promise.resolve())
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(report).toHaveBeenCalledWith('Unhandled promise rejection: nope', { error: 'nope' })
  })

  it('does not exit when the application has its own handler', async () => {
    const { target, emitter, exit } = fakeProcess()
    const flush = vi.fn(async () => undefined)
    emitter.on('uncaughtException', () => undefined)
    stop = captureUncaught({ report: async () => undefined, flush, target })

    emitter.emit('uncaughtException', new Error('boom'), 'uncaughtException')
    await vi.waitFor(() => expect(flush).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(exit).not.toHaveBeenCalled()
  })

  it('exits after the timeout when sending takes too long', async () => {
    const { target, emitter, exit } = fakeProcess()
    stop = captureUncaught({
      report: () => new Promise(() => undefined),
      flush: async () => undefined,
      flushTimeoutMs: 30,
      target,
    })

    emitter.emit('uncaughtException', new Error('boom'), 'uncaughtException')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
  })

  it('can be enabled for only one logger at a time', () => {
    const { target } = fakeProcess()
    const hooks = { report: async () => undefined, flush: async () => undefined, target }

    stop = captureUncaught(hooks)
    expect(() => captureUncaught(hooks)).toThrow('already enabled')

    stop()
    stop = captureUncaught(hooks)
  })
})

describe('KelopsLogger captureUncaught option', () => {
  it('adds the listeners and removes them on close', async () => {
    const before = process.listenerCount('uncaughtException')
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      captureUncaught: true,
      fetch: (async () => new Response('{}', { status: 202 })) as typeof fetch,
    })

    expect(process.listenerCount('uncaughtException')).toBe(before + 1)
    await logger.close()
    expect(process.listenerCount('uncaughtException')).toBe(before)
  })

  it('is off by default', () => {
    const before = process.listenerCount('uncaughtException')
    new KelopsLogger({ apiKey: 'klp_key', service: 'billing' })
    expect(process.listenerCount('uncaughtException')).toBe(before)
  })
})
