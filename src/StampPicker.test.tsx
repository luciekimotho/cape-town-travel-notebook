import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StampPicker } from './StampPicker'
import { TravelStamp } from './Artwork'
import { MomentPostcard } from './MomentPostcard'
import type { StampDesign } from './stampDesign'

afterEach(cleanup)

function Preview() {
  const [value, setValue] = useState<StampDesign>('pin')
  const [name, setName] = useState('My Table Mountain picnic')
  return <><label>Name<input value={name} onChange={event => setName(event.target.value)}/></label><StampPicker name={name} value={value} date="2026-09-25" onChange={setValue}/></>
}

describe('stamp design selection', () => {
  it('starts with a named neutral default and previews every selectable design', () => {
    const { container } = render(<Preview/>)
    expect(screen.getByRole('img', { name: 'My Table Mountain picnic travel stamp, SEPT 2026' })).toHaveAttribute('data-stamp-kind', 'pin')
    fireEvent.click(screen.getByText('Choose a design'))
    const choices = screen.getAllByRole('radio')
    expect(choices).toHaveLength(13)
    for (const choice of choices) {
      fireEvent.click(choice)
      const expected = choice.getAttribute('value') === 'auto' ? 'mountain' : choice.getAttribute('value')
      expect(container.querySelector('[data-safe-stamp]')).toHaveAttribute('data-stamp-kind', expected)
      expect(container.querySelector('.stamp-name')?.textContent).toBe('MY TABLE MOUNTAIN PICNIC')
      expect(choice).toBeChecked()
    }
  })

  it('keeps the chosen illustration when the draft name changes', () => {
    const { container } = render(<Preview/>)
    fireEvent.click(screen.getByText('Choose a design'))
    fireEvent.click(screen.getByRole('radio', { name: 'Lighthouse' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Our afternoon walk' } })
    expect(container.querySelector('.stamp-name')?.textContent).toBe('OUR AFTERNOON WALK')
    expect(screen.getByRole('img', { name: 'Our afternoon walk travel stamp, SEPT 2026' })).toHaveAttribute('data-stamp-kind', 'lighthouse')
  })

  it('retains automatic matching for legacy stamps and carries overrides into Moments', () => {
    render(<><TravelStamp name="Table Mountain" date="2026-09-25"/><MomentPostcard name="Table Mountain" date="2026-09-25" caption="Personal memory" stampKind="house" onOpen={() => {}}/></>)
    expect(screen.getAllByRole('img', { name: /Table Mountain travel stamp/ })[0]).toHaveAttribute('data-stamp-kind', 'mountain')
    expect(within(screen.getByRole('button')).getByRole('img', { name: /Table Mountain travel stamp/ })).toHaveAttribute('data-stamp-kind', 'house')
  })

  it('disables selection during an acknowledged save', () => {
    render(<StampPicker name="Picnic" value="pin" date="2026-09-25" disabled onChange={() => {}}/>)
    fireEvent.click(screen.getByText('Choose a design'))
    for (const choice of screen.getAllByRole('radio')) expect(choice).toBeDisabled()
  })
})
