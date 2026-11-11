import { describe, expect, it } from 'vitest'
import { KelopsClient } from '../src/client'
import { accepted, bodyOf, makeLogs, mockFetch, reply } from './helpers'

const fastRetry = { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }

describe('KelopsClient', () => {
  it('requires an api key', () => {
    expect(() => new KelopsClient({ apiKey: '' })).toThrow(TypeError)
  })

  it('does not send an empty list', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const client = new KelopsClient({ apiKey: 'klp_key', fetch })

    expect(await client.send([])).toEqual({ accepted: 0, rejected: 0 })
    expect(calls).toHaveLength(0)
  })

  it('splits large lists into requests of 2000 items', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const client = new KelopsClient({ apiKey: 'klp_key', fetch })

    const result = await client.send(makeLogs(4500))

    expect(calls.map((call) => bodyOf(call).logs.length)).toEqual([2000, 2000, 500])
    expect(result).toEqual({ accepted: 4500, rejected: 0 })
  })

  it('keeps the first rejection reason', async () => {
    const { fetch } = mockFetch(
      reply({ success: true, accepted: 1, rejected: 1, error: { code: 'ITEMS_REJECTED', message: 'first' } }),
    )
    const client = new KelopsClient({ apiKey: 'klp_key', fetch })

    expect(await client.send(makeLogs(2))).toEqual({
      accepted: 1,
      rejected: 1,
      error: { code: 'ITEMS_REJECTED', message: 'first' },
    })
  })

  it('retries a temporary failure', async () => {
    const { fetch, calls } = mockFetch(
      reply({ error: { code: 'OVERLOADED', message: 'busy' } }, 503),
      reply({ success: true, accepted: 1, rejected: 0 }),
    )
    const client = new KelopsClient({ apiKey: 'klp_key', fetch, retry: fastRetry })

    expect(await client.send(makeLogs(1))).toEqual({ accepted: 1, rejected: 0 })
    expect(calls).toHaveLength(2)
  })

  it('sends the remaining parts when one part fails and throws the first failure', async () => {
    const { fetch, calls } = mockFetch(
      reply({ error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } }, 401),
      accepted(),
    )
    const client = new KelopsClient({ apiKey: 'klp_key', fetch, retry: fastRetry })

    await expect(client.send(makeLogs(2001))).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
    expect(calls).toHaveLength(2)
  })

  it('passes the project id', async () => {
    const { fetch, calls } = mockFetch(accepted())
    const client = new KelopsClient({ apiKey: 'klp_key', projectId: 'project_1', fetch })

    await client.send(makeLogs(1))
    expect(bodyOf(calls[0]!).project_id).toBe('project_1')
  })
})
