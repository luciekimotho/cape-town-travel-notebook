import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkerIcon, PlaceScene, PlaceThumbnail, TravelStamp, stampLayout, stampMonthLabel, stampTextLines, type ArtKind } from './Artwork'

describe('travel stamp artwork', () => {
  it('shows only the visit month and year', () => {
    expect(stampMonthLabel('2026-09-25')).toBe('SEPT 2026')
    expect(stampMonthLabel('2027-01-04')).toBe('JAN 2027')
    expect(stampMonthLabel()).toBe('CAPE TOWN')
    const markup = renderToStaticMarkup(<TravelStamp name="Boulders Penguin Colony" date="2026-09-25"/>)
    expect(markup).toContain('SEPT 2026')
    expect(markup).not.toContain('25 SEP')
  })

  it('wraps long identities without truncating the text', () => {
    const name = 'A very long custom Cape Town activity name with punctuation, viewpoints and picnic plans!!'
    expect(name).toHaveLength(90)
    const lines = stampTextLines(name)
    expect(lines.length).toBeGreaterThan(4)
    expect(lines.join('').replaceAll(' ', '')).toBe(name.toUpperCase().replaceAll(' ', ''))
    const markup = renderToStaticMarkup(<TravelStamp name={name} date="2026-09-25"/>)
    expect(markup.match(/<tspan/g)).toHaveLength(stampLayout(name).lines.length)
    expect(markup).not.toContain('…')
    expect(markup).not.toContain('VISITED')
  })

  it.each(['Bo-Kaap', 'New Cape Point Lighthouse', 'Boulders Penguin Colony', 'W'.repeat(90), '海'.repeat(90), '🌊'.repeat(45)])('keeps a uniform compact frame and a complete identity: %s', name => {
    const layout = stampLayout(name)
    expect(layout.lines.join('')).toBe(name.toUpperCase())
    expect(layout.fontSize).toBeGreaterThanOrEqual(7.5)
    expect(layout.markerScale).toBeGreaterThan(0)
    const markup = renderToStaticMarkup(<TravelStamp name={name} date="2026-09-25"/>)
    const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
    expect(document.documentElement.getAttribute('viewBox')).toBe('0 0 128 129')
    expect([...document.documentElement.children].filter(element => element.tagName === 'path')).toHaveLength(0)
    expect(document.querySelector('.stamp-month')?.getAttribute('y')).toBe('112')
  })

  it('keeps regular place-name lettering unchanged and adjusts illustration space instead', () => {
    const short = stampLayout('Bo-Kaap')
    const long = stampLayout('New Cape Point Lighthouse')
    expect(short.fontSize).toBe(10)
    expect(long.fontSize).toBe(10)
    expect(long.markerTop).toBeGreaterThan(short.markerTop)
    expect(long.markerScale).toBeLessThan(short.markerScale)
  })
})

describe('place scene artwork', () => {
  it('renders each scene family, including a neutral fallback', () => {
    const samples: Record<ArtKind, string> = {
      mountain: 'Table Mountain',
      penguin: 'Boulders Penguins',
      house: 'Bo-Kaap',
      cape: 'Cape Peninsula Tour',
      lighthouse: 'Cape Point Lighthouse',
      road: "Chapman's Peak Drive",
      boat: 'V&A Waterfront',
      huts: 'Muizenberg',
      promenade: 'Sea Point Promenade',
      wine: 'Winelands',
      cliff: 'Cape of Good Hope',
      pin: 'Notebook stop',
    }
    for (const [kind, name] of Object.entries(samples)) {
      const markup = renderToStaticMarkup(<PlaceScene name={name}/>)
      expect(markup, kind).toContain('viewBox="0 0 350 150"')
      expect(markup, kind).toContain(`data-scene="${kind}"`)
      expect(markup, kind).toContain('preserveAspectRatio="xMidYMid slice"')
      expect(markup, kind).toContain('aria-hidden="true"')
      expect(markup, kind).not.toMatch(/<(image|script|animate|text)\b/)
      expect(markup, kind).not.toMatch(/(?:href|id)=/)
      const thumbnail = renderToStaticMarkup(<PlaceThumbnail name={name}/>)
      expect(thumbnail, kind).toContain(`data-thumbnail="${kind}"`)
      expect(thumbnail, kind).toContain(`data-marker-fill="${kind}"`)
      expect(thumbnail, kind).toContain('preserveAspectRatio="xMidYMid meet"')
      expect(thumbnail, kind).not.toContain('data-scene')
    }
    const rendered = Object.values(samples).map(name => renderToStaticMarkup(<PlaceScene name={name}/>))
    expect(new Set(rendered).size).toBe(12)
  })

  it('keeps unknown places neutral and preserves custom sizing classes', () => {
    const markup = renderToStaticMarkup(<PlaceScene name="Lunch with friends" className="detached-scene"/>)
    expect(markup).toContain('data-scene="pin"')
    expect(markup).toContain('class="detached-scene"')
    expect(markup).toContain('focusable="false"')
    expect(markup).toContain('rotate(-9)')
    expect(markup).not.toContain('data-scene="mountain"')
  })

  it('colors the existing line symbol without changing default stamp markers', () => {
    const plain = renderToStaticMarkup(<MarkerIcon kind="house"/>)
    const colorful = renderToStaticMarkup(<MarkerIcon kind="house" colorful/>)
    const plainSvg = new DOMParser().parseFromString(plain, 'image/svg+xml')
    const colorSvg = new DOMParser().parseFromString(colorful, 'image/svg+xml')
    colorSvg.querySelector('[data-marker-fill]')?.remove()
    expect([...colorSvg.querySelectorAll('path')].map(path => path.getAttribute('d')))
      .toEqual([...plainSvg.querySelectorAll('path')].map(path => path.getAttribute('d')))
    expect(plain).not.toContain('data-marker-fill')
    expect(renderToStaticMarkup(<TravelStamp name="Bo-Kaap"/>)).not.toContain('data-marker-fill')
    expect(renderToStaticMarkup(<PlaceThumbnail name="Lunch with friends"/>)).toContain('data-thumbnail="pin"')
  })
})
