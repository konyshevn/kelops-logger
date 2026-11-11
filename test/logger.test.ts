import { afterEach, describe, expect, it, vi } from 'vitest'
import { KelopsLogger } from '../src/logger'
import type { KelopsError } from '../src/errors'
import { accepted, bodyOf, deferred, fail, mockFetch, reply } from './helpers'

const fastRetry = { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 }

afterEach(() => {
  vi.useRealTimers()
})

describe('KelopsLogger', () => {
  it('requires a service', () => {
    expect(() => new KelopsLogger({ apiKey: 'klp_key', service: '' })).toThrow(TypeError)
  })

  it('sends one log entry per call', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    await logger.info('started', { port: 3000 })

    expect(calls).toHaveLength(1)
    const [entry] = bodyOf(calls[0]!).logs
    expect(entry).toMatchObject({
      level: 'info',
      service: 'billing',
      message: 'started',
      context: { port: 3000 },
    })
    expect(entry!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('does not add an empty context', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    await logger.info('started')
    expect('context' in bodyOf(calls[0]!).logs[0]!).toBe(false)
  })

  it('maps every method to its level', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    await logger.debug('a')
    await logger.info('b')
    await logger.warn('c')
    await logger.error('d')

    expect(calls.map((call) => bodyOf(call).logs[0]!.level)).toEqual(['debug', 'info', 'warn', 'error'])
  })

  it('allows another service for a single call', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    await logger.log({ level: 'warn', message: 'slow', service: 'payments' })
    expect(bodyOf(calls[0]!).logs[0]!.service).toBe('payments')
  })

  it('serializes errors in the context', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    await logger.error('failed', { error: new Error('boom') })
    const context = bodyOf(calls[0]!).logs[0]!.context as { error: { message: string } }
    expect(context.error.message).toBe('boom')
  })

  it('reports partially rejected logs', async () => {
    const { fetch } = mockFetch(
      reply({
        success: true,
        accepted: 0,
        rejected: 1,
        error: { code: 'ITEMS_REJECTED', message: 'logs[0]: message is required' },
      }),
    )
    const errors: KelopsError[] = []
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch, onError: (e) => errors.push(e) })

    await logger.info('')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'ITEMS_REJECTED', message: 'logs[0]: message is required' })
  })

  it('reports a failed delivery and does not reject', async () => {
    const { fetch } = mockFetch(fail(new TypeError('fetch failed')))
    const errors: KelopsError[] = []
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      retry: fastRetry,
      onError: (e) => errors.push(e),
    })

    await expect(logger.info('started')).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'NETWORK' })
  })

  it('survives an onError callback that throws', async () => {
    const { fetch } = mockFetch(fail(new TypeError('fetch failed')))
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      retry: fastRetry,
      onError: () => {
        throw new Error('callback failed')
      },
    })

    await expect(logger.info('started')).resolves.toBeUndefined()
  })

  it('refuses new logs after close', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const errors: KelopsError[] = []
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch, onError: (e) => errors.push(e) })

    await logger.close()
    await logger.info('late')

    expect(calls).toHaveLength(0)
    expect(errors[0]).toMatchObject({ code: 'CLOSED' })
  })

  it('waits for requests in progress on flush', async () => {
    const gate = deferred<Response>()
    const { fetch } = mockFetch(() => gate.promise)
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch })

    void logger.info('started')
    let flushed = false
    const flushing = logger.flush().then(() => {
      flushed = true
    })

    await Promise.resolve()
    expect(flushed).toBe(false)

    gate.resolve(new Response(JSON.stringify({ success: true, accepted: 1, rejected: 0 }), { status: 202 }))
    await flushing
    expect(flushed).toBe(true)
  })
})

describe('KelopsLogger with buffer', () => {
  it('sends a batch when the batch size is reached', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      buffer: { batchSize: 3, intervalMs: 60_000 },
    })

    await logger.info('1')
    await logger.info('2')
    expect(calls).toHaveLength(0)

    await logger.info('3')
    await logger.flush()

    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0]!).logs.map((entry) => entry.message)).toEqual(['1', '2', '3'])
  })

  it('sends what is queued when the interval passes', async () => {
    vi.useFakeTimers()
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      buffer: { batchSize: 100, intervalMs: 2000 },
    })

    await logger.info('1')
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(1)
  })

  it('sends the rest on close', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const logger = new KelopsLogger({ apiKey: 'klp_key', service: 'billing', fetch, buffer: {} })

    await logger.info('1')
    await logger.info('2')
    await logger.close()

    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0]!).logs).toHaveLength(2)
  })

  it('drops the oldest logs when the queue is full and reports it once', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const errors: KelopsError[] = []
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      onError: (e) => errors.push(e),
      buffer: { batchSize: 100, intervalMs: 60_000, maxQueue: 2 },
    })

    for (const message of ['1', '2', '3', '4']) {
      await logger.info(message)
    }
    await logger.flush()

    expect(bodyOf(calls[0]!).logs.map((entry) => entry.message)).toEqual(['3', '4'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'QUEUE_OVERFLOW' })
  })

  it('keeps one request in flight and collects the rest in the queue', async () => {
    const gate = deferred<Response>()
    const { fetch, calls } = mockFetch(() => gate.promise, accepted())
    const logger = new KelopsLogger({
      apiKey: 'klp_key',
      service: 'billing',
      fetch,
      buffer: { batchSize: 1, intervalMs: 60_000 },
    })

    await logger.info('1')
    await logger.info('2')
    await logger.info('3')
    expect(calls).toHaveLength(1)

    gate.resolve(new Response(JSON.stringify({ success: true, accepted: 1, rejected: 0 }), { status: 202 }))
    await logger.flush()

    expect(calls).toHaveLength(2)
    expect(bodyOf(calls[1]!).logs.map((entry) => entry.message)).toEqual(['2', '3'])
  })
})
