import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentPostcard, PostcardStamp } from './MomentPostcard'
import { TravelStamp } from './Artwork'

afterEach(cleanup)

const names = [
  'Bo-Kaap',
  'New Cape Point Lighthouse',
  'Boulders Penguin Colony',
  'A very long custom Cape Town activity name with punctuation, viewpoints and picnic plans!!',
  'W'.repeat(90),
  'Café, São Tomé & Kaapstad — 海辺の散歩 🌊 e\u0301',
  'Words  with   spaces / punctuation & (parentheses)',
]

describe('postcard names', () => {
  it.each(names)('preserves the exact full identity inside the border: %s', name => {
    const { container } = render(<MomentPostcard name={name} date="2026-09-25" caption="Preview" onOpen={() => {}}/>)
    const border = container.querySelector('.postcard-stamp')!
    expect(border.querySelector('.stamp-name')?.textContent).toBe(name.toUpperCase())
    expect(border.querySelector('.stamp-month')?.textContent).toBe('SEPT 2026')
    expect(border.querySelector('clipPath, textPath')).toBeNull()
    expect(container.textContent).not.toMatch(/visited/i)
    expect(container.querySelectorAll('.stamp-name')).toHaveLength(1)
    expect(container.querySelector('.postcard-visual [data-scene]')).not.toBeNull()
  })

  it('preserves the photo, caption, and open action', () => {
    const onOpen = vi.fn()
    const { container } = render(<MomentPostcard name="Boulders Penguin Colony" date="2026-09-25" caption="A special memory" photo={<img src="data:image/png;base64,iVBORw0KGgo=" alt="Preview photo"/>} onOpen={onOpen}/>)
    expect(screen.getByAltText('Preview photo')).toBeInTheDocument()
    expect(container.querySelector('[data-scene]')).toBeNull()
    expect(screen.getByText('A special memory')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('uses the same safe-area stamp for detached memories with no visited text anywhere', () => {
    const { container } = render(<><PostcardStamp name={names[4]} date="2027-01-04"/><TravelStamp name="Bo-Kaap" date="2026-09-25"/></>)
    expect(container.querySelector('.postcard-stamp')?.textContent).toBe(`${names[4]}JAN 2027`)
    expect(container.querySelector('.postcard-stamp')?.textContent).not.toMatch(/visited/i)
    expect(screen.queryByText('VISITED')).not.toBeInTheDocument()
  })
})
