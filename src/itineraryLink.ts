export function normalizeItineraryLink(value: string | undefined): string | undefined {
  const link = value?.trim()
  if (!link) return undefined
  let url: URL
  try { url = new URL(link) } catch { throw new Error('Enter a valid GetYourGuide or Google Maps link.') }
  const host = url.hostname.toLowerCase()
  const googleHost = host === 'maps.google.com' ||
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl' ||
    /^(?:www\.)?google\.[a-z.]+$/.test(host)
  const googlePath = host === 'goo.gl' ? url.pathname.startsWith('/maps') :
    host === 'maps.app.goo.gl' || host === 'maps.google.com' || url.pathname.startsWith('/maps')
  const getYourGuide = (host === 'getyourguide.com' || host === 'www.getyourguide.com') && url.pathname !== '/'
  if (url.protocol !== 'https:' || (!getYourGuide && !(googleHost && googlePath))) {
    throw new Error('Use an HTTPS GetYourGuide or Google Maps link.')
  }
  if (link.length > 2000) throw new Error('The activity link is too long.')
  return url.toString()
}

export function itineraryLinkLabel(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().includes('getyourguide.com')
      ? 'Open on GetYourGuide'
      : 'Open in Google Maps'
  } catch {
    return 'Open activity link'
  }
}

export function isItineraryLink(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return Boolean(normalizeItineraryLink(value)) } catch { return false }
}
