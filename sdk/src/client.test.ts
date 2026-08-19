import { expect, test } from 'vitest'
import { entrypoint } from './client.ts'

test('client entry point is exported', () => {
  expect(entrypoint).toBe('client')
})
