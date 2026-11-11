import { describe, expect, it } from 'vitest'
import { KelopsError } from '../src/errors'
import { post, type TransportOptions } from '../src/transport'
import { bodyOf, fail, makeLogs, mockFetch, reply } from './helpers'

function options(fetchImpl: typeof fetch, extra: Partial<TransportOptions> = {}): TransportOptions {
  return {
    url: 'https://ingest.test',
    apiKey: 'klp_key',
    projectId: 'project_1',
    timeoutMs: 1000,
    fetch: fetchImpl,
    ...extra,
  }
}

describe('post', () => {
  it('sends a POST request with the key and the logs', async () => {
    const { fetch, calls } = mockFetch(reply({ success: true, accepted: 1, rejected: 0 }))
    await post(options(fetch), makeLogs(1))

    const call = calls[0]!
    expect(call.url).toBe('https://ingest.test/api/v1/telemetry')
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer klp_key',
    })
    expect(bodyOf(call).project_id).toBe('project_1')
    expect(bodyOf(call).logs).toHaveLength(1)
  })

  it('omits project_id when it is not set', async () => {
    const { fetch, calls } = mockFetch(reply({ success: true, accepted: 1, rejected: 0 }))
    await post(options(fetch, { projectId: undefined }), makeLogs(1))
    expect('project_id' in bodyOf(calls[0]!)).toBe(false)
  })

  it('returns the counters from the response', async () => {
    const { fetch } = mockFetch(reply({ success: true, accepted: 3, rejected: 0 }))
    expect(await post(options(fetch), makeLogs(3))).toEqual({ accepted: 3, rejected: 0 })
  })

  it('returns the reason when some items are rejected', async () => {
    const { fetch } = mockFetch(
      reply({
        success: true,
        accepted: 2,
        rejected: 1,
        error: { code: 'ITEMS_REJECTED', message: 'logs[1]: level is required' },
      }),
    )
    expect(await post(options(fetch), makeLogs(3))).toEqual({
      accepted: 2,
      rejected: 1,
      error: { code: 'ITEMS_REJECTED', message: 'logs[1]: level is required' },
    })
  })

  it('throws the api error when everything is rejected', async () => {
    const { fetch } = mockFetch(
      reply(
        {
          success: false,
          accepted: 0,
          rejected: 1,
          error: { code: 'VALIDATION_FAILED', message: 'logs[0]: message is required' },
        },
        400,
      ),
    )
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({
      name: 'KelopsError',
      code: 'VALIDATION_FAILED',
      message: 'logs[0]: message is required',
      status: 400,
    })
  })

  it('throws an auth error', async () => {
    const { fetch } = mockFetch(reply({ error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } }, 401))
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
      status: 401,
    })
  })

  it('reads Retry-After in seconds', async () => {
    const { fetch } = mockFetch(
      reply({ error: { code: 'RATE_LIMITED', message: 'Too many records' } }, 429, { 'retry-after': '2' }),
    )
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterMs: 2000,
    })
  })

  it('uses the http status when the body is not json', async () => {
    const { fetch } = mockFetch(() => new Response('Bad Gateway', { status: 502 }))
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({
      code: 'HTTP_502',
      status: 502,
    })
  })

  it('reports a network failure', async () => {
    const { fetch } = mockFetch(fail(new TypeError('fetch failed')))
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('reports a timeout', async () => {
    const { fetch } = mockFetch(fail(new DOMException('The operation timed out', 'TimeoutError')))
    await expect(post(options(fetch), makeLogs(1))).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('reports logs that cannot be serialized', async () => {
    const { fetch, calls } = mockFetch(reply({ success: true, accepted: 1, rejected: 0 }))
    const logs = makeLogs(1)
    logs[0]!.context = {
      get broken() {
        throw new Error('getter failed')
      },
    }
    const error = await post(options(fetch), logs).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KelopsError)
    expect(error).toMatchObject({ code: 'SERIALIZATION_FAILED' })
    expect(calls).toHaveLength(0)
  })
})
