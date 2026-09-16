import { afterEach, describe, expect, it } from 'vitest'
import { consumeAuthCallbackError } from './auth'

describe('auth callback errors', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('surfaces and clears an expired magic-link error', () => {
    window.history.replaceState(null, '', '/cape-town-travel-notebook/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')

    expect(consumeAuthCallbackError()).toBe('Email link is invalid or has expired')
    expect(window.location.hash).toBe('')
  })
})
