import { describe, expect, it } from 'vitest'
import { serialize } from '../src/serialize'

describe('serialize', () => {
  it('turns errors into plain objects', () => {
    const error = new Error('boom')
    const parsed = JSON.parse(serialize({ error }))
    expect(parsed.error.name).toBe('Error')
    expect(parsed.error.message).toBe('boom')
    expect(parsed.error.stack).toContain('boom')
  })

  it('includes the cause of an error', () => {
    const error = new Error('outer', { cause: new Error('inner') })
    const parsed = JSON.parse(serialize({ error }))
    expect(parsed.error.cause.message).toBe('inner')
  })

  it('replaces circular references', () => {
    const value: Record<string, unknown> = { name: 'a' }
    value.self = value
    expect(JSON.parse(serialize(value))).toEqual({ name: 'a', self: '[Circular]' })
  })

  it('keeps repeated references that are not circular', () => {
    const shared = { id: 1 }
    expect(JSON.parse(serialize({ first: shared, second: shared }))).toEqual({
      first: { id: 1 },
      second: { id: 1 },
    })
  })

  it('converts bigint to string', () => {
    expect(JSON.parse(serialize({ id: 10n }))).toEqual({ id: '10' })
  })
})
