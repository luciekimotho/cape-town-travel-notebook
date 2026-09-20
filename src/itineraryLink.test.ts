import { describe, expect, it } from 'vitest'
import { itineraryLinkLabel, normalizeItineraryLink } from './itineraryLink'

describe('itinerary links', () => {
  it.each([
    'https://www.getyourguide.com/en-gb/cape-town-l103/example-t123/',
    'https://www.google.com/maps/search/?api=1&query=Camps+Bay',
    'https://maps.google.com/?q=Cape+Town',
    'https://maps.app.goo.gl/abcdefgh',
    'https://goo.gl/maps/abcdefgh',
  ])('accepts supported HTTPS links: %s', link => {
    expect(normalizeItineraryLink(link)).toMatch(/^https:/)
  })

  it.each([
    'http://www.getyourguide.com/example',
    'https://example.com/maps',
    'https://evilgetyourguide.com/example',
    'https://www.google.com/search?q=Cape+Town',
    'javascript:alert(1)',
  ])('rejects unsupported links: %s', link => {
    expect(() => normalizeItineraryLink(link)).toThrow()
  })

  it('handles blanks and labels supported providers', () => {
    expect(normalizeItineraryLink('  ')).toBeUndefined()
    expect(itineraryLinkLabel('https://www.getyourguide.com/example')).toBe('Open on GetYourGuide')
    expect(itineraryLinkLabel('https://www.google.com/maps/search/?q=x')).toBe('Open in Google Maps')
  })
})
