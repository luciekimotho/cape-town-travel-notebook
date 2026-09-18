import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('save error messages', () => {
  it('preserves PostgreSQL errors returned as plain objects by Supabase', () => {
    expect(errorMessage({
      message: 'constraint "itinerary_parent_guard" does not exist',
      code: '42704', details: null, hint: null,
    }, 'Retry')).toBe('constraint "itinerary_parent_guard" does not exist (42704)')
  })

  it('preserves ordinary errors and safely handles malformed failures', () => {
    expect(errorMessage(new Error('Offline'), 'Retry')).toBe('Offline')
    for (const value of [null, undefined, {}, { message: 5 }, { message: '' }]) {
      expect(errorMessage(value, 'Retry')).toBe('Retry')
    }
  })
})
