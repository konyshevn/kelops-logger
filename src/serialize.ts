function describeError(error: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
  if (error.cause !== undefined) {
    result.cause = error.cause
  }
  return result
}

function createReplacer() {
  const ancestors: object[] = []

  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value.toString()
    }
    const current = value instanceof Error ? describeError(value) : value
    if (typeof current !== 'object' || current === null) {
      return current
    }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop()
    }
    if (ancestors.includes(current)) {
      return '[Circular]'
    }
    ancestors.push(current)
    return current
  }
}

export function serialize(value: unknown): string {
  return JSON.stringify(value, createReplacer())
}
