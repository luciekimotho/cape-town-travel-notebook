import { useId } from 'react'
import { artKindFor, colorForKind, MarkerIcon, TravelStamp } from './Artwork'
import type { StampDesign } from './stampDesign'
import './StampPicker.css'

const designs: Array<{ value: StampDesign; label: string }> = [
  { value: 'pin', label: 'Default' },
  { value: 'auto', label: 'Automatic' },
  { value: 'mountain', label: 'Table Mountain' },
  { value: 'penguin', label: 'Penguins' },
  { value: 'house', label: 'Bo-Kaap' },
  { value: 'cape', label: 'Cape tour' },
  { value: 'lighthouse', label: 'Lighthouse' },
  { value: 'road', label: 'Coastal road' },
  { value: 'boat', label: 'Harbour' },
  { value: 'huts', label: 'Beach huts' },
  { value: 'promenade', label: 'Promenade' },
  { value: 'wine', label: 'Winelands' },
  { value: 'cliff', label: 'Cape cliffs' },
]

export function StampPicker({ name, value, date, disabled, onChange }: {
  name: string
  value: StampDesign
  date: string
  disabled?: boolean
  onChange: (value: StampDesign) => void
}) {
  const id = useId()
  const selected = designs.find(design => design.value === value)!
  return <fieldset className="stamp-picker" disabled={disabled}>
    <legend>Stamp design</legend>
    <div className="stamp-picker-preview">
      <TravelStamp name={name.trim() || 'Your place name'} date={date} stampKind={value}/>
      <div><strong>{selected.label}</strong><p>Your place name stays on every design.</p></div>
    </div>
    <details className="stamp-picker-options">
      <summary>Choose a design</summary>
      <div className="stamp-picker-grid">
        {designs.map(({ value: choice, label }) => {
          const kind = choice === 'auto' ? artKindFor(name) : choice
          return <label key={choice} className="stamp-picker-option" style={{ color: colorForKind(kind) }}>
            <input type="radio" name="stampKind" value={choice} checked={value === choice} onChange={() => onChange(choice)} aria-describedby={`${id}-hint`}/>
            <span><MarkerIcon kind={kind}/><span>{label}</span></span>
          </label>
        })}
      </div>
      <p id={`${id}-hint`} className="stamp-picker-hint">Default uses a neutral place symbol. Automatic matches the name.</p>
    </details>
  </fieldset>
}
