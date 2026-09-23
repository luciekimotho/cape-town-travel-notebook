import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('safe user error guidance', () => {
  it('does not expose PostgreSQL details returned by Supabase', () => {
    expect(errorMessage({
      message: 'constraint "itinerary_parent_guard" does not exist',
      code: '42704', details: null, hint: null,
    }, 'Try saving again.')).toBe('Try saving again.')
  })

  it('turns recognizable failures into actions and safely handles malformed failures', () => {
    expect(errorMessage(new Error('Offline'), 'Retry')).toBe('Check your connection and try again.')
    expect(errorMessage(new Error('Storage quota exceeded'), 'Retry')).toBe('Free some storage on this device, then try again.')
    expect(errorMessage(new Error('Invalid login credentials'), 'Retry')).toBe('Check your email and password, then try again.')
    for (const value of [null, undefined, {}, { message: 5 }, { message: '' }]) {
      expect(errorMessage(value, 'Retry')).toBe('Retry')
    }
  })
})
