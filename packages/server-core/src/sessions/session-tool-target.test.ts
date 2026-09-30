import { describe, it, expect } from 'bun:test'
import { resolveToolTargetSessionId, resolveWritableToolTarget } from './session-tool-target.ts'

describe('resolveToolTargetSessionId', () => {
  const cases: Array<[string, string | undefined, string]> = [
    ['omitted id targets the invoking session', undefined, 'self'],
    ['empty string targets the invoking session', '', 'self'],
    ['whitespace-only id targets the invoking session', '   ', 'self'],
    ['explicit own id is kept', 'self', 'self'],
    ['explicit other id is kept', 'other', 'other'],
  ]
  for (const [name, requested, expected] of cases) {
    it(name, () => {
      expect(resolveToolTargetSessionId(requested, 'self')).toBe(expected)
    })
  }
})

describe('resolveWritableToolTarget', () => {
  const known = new Set(['self', 'other'])
  const exists = (id: string) => known.has(id)

  it('resolves an empty id to the invoking session', () => {
    expect(resolveWritableToolTarget('', 'self', exists)).toBe('self')
  })

  it('keeps an explicit existing target', () => {
    expect(resolveWritableToolTarget('other', 'self', exists)).toBe('other')
  })

  it('throws for an unknown target instead of letting the write no-op', () => {
    expect(() => resolveWritableToolTarget('ghost', 'self', exists)).toThrow('Session ghost not found')
  })
})
