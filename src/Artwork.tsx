import { SceneIllustration } from './SceneIllustrations'
import type { ReactNode } from 'react'
import type { StampDesign, StampKind } from './stampDesign'

export type ArtKind = StampKind | 'home' | 'family' | 'dinner' | 'packing' | 'plane'

const normalized = (name: string) => name.toLowerCase()

export function artKindFor(name: string): ArtKind {
  const value = normalized(name)
  if (value.includes('dinner with family') || value.includes('family dinner')) return 'dinner'
  if (value.includes('hanging out with the kids') || value.includes('say goodbye') || value.includes('family time')) return 'family'
  if (value.includes('final packing') || value.includes('packing and documents')) return 'packing'
  if (value.includes('final home') || value.includes('travel preparations')) return 'home'
  if (value.includes('airport') || value.includes('airlines') || value.includes('board et') || value.includes('flight') || value.includes('nbo check-in')) return 'plane'
  if (value.includes('penguin') || value.includes('boulders')) return 'penguin'
  if (value.includes('lighthouse') || value.includes('cape point')) return 'lighthouse'
  if (value.includes('muizenberg')) return 'huts'
  if (value.includes('chapman') || value.includes('drive')) return 'road'
  if (value.includes('boat') || value.includes('waterfront') || value.includes('hout bay')) return 'boat'
  if (value.includes('sea point') || value.includes('promenade')) return 'promenade'
  if (value.includes('wine') || value.includes('vineyard')) return 'wine'
  if (value.includes('good hope')) return 'cliff'
  if (value.includes('bo-kaap') || value.includes("simon's town")) return 'house'
  if (value.includes('peninsula') || value.includes('cape town red bus')) return 'cape'
  if (value.includes('mountain')) return 'mountain'
  return 'pin'
}

export function colorForKind(kind: ArtKind) {
  if (kind === 'family' || kind === 'dinner') return '#bc3557'
  if (kind === 'home') return '#315f2e'
  if (kind === 'packing') return '#2855a6'
  if (kind === 'house') return '#bc3557'
  if (kind === 'penguin' || kind === 'cape' || kind === 'promenade') return '#2855a6'
  if (kind === 'lighthouse' || kind === 'cliff') return '#315f2e'
  if (kind === 'road' || kind === 'huts') return '#8b5700'
  return '#006b72'
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const markerFills: Record<ArtKind, ReactNode> = {
  mountain: <><path d="M20 73 37 47h12l9-17h34l10 43Z" fill="#008c95"/><path d="m20 73 17-26h12l9-17 11 43Z" fill="#e95070"/><path d="M70 42h18l-9 9Z" fill="#e7a928"/></>,
  penguin: <><path d="M43 72c-5-22 1-39 15-39s20 17 15 39Z" fill="#2855a6"/><ellipse cx="58" cy="42" rx="10" ry="8" fill="#fffaf0"/><ellipse cx="58" cy="59" rx="9" ry="15" fill="#fffaf0"/><path d="M82 73c-3-14 1-25 11-25s14 11 11 25Z" fill="#008c95"/><ellipse cx="93" cy="55" rx="7" ry="5" fill="#fffaf0"/><ellipse cx="93" cy="67" rx="5" ry="9" fill="#fffaf0"/><path d="m53 44 5 4 5-4m26 12 4 3 4-3" fill="#e7a928"/><path d="M48 76l-9 4m27-4 9 4m13-3-6 3m17-3 6 3" stroke="#e7a928" strokeWidth="6"/></>,
  house: <><path d="M24 79V45l15-10 15 10v34Z" fill="#e95070"/><path d="M54 79V38l16-9 16 9v41Z" fill="#008c95"/><path d="M86 79V50l15-9 14 9v29Z" fill="#e7a928"/><path d="M35 79V61h9v18m22 0V58h9v21m20 0V64h9v15" fill="#fffaf0"/></>,
  cape: <><path d="m32 37 25 8-9 13 22 7-4 10 24 6H30Z" fill="#4e8548"/><circle cx="33" cy="36" r="4" fill="#e95070"/><path d="M73 43h14l-7-7Z" fill="#e7a928"/><path d="M30 83q12-9 24 0t24 0t24 0v9H30Z" fill="#008c95"/></>,
  lighthouse: <><path d="m50 78 6-29h16l6 29Z" fill="#fffaf0"/><path d="M53 64h22l2 8H52Z" fill="#e95070"/><path d="M55 39h19v10H55Z" fill="#e7a928"/><path d="m52 39 12-9 13 9Z" fill="#e95070"/></>,
  road: <><path d="M17 75 39 43l22 17 18-26 27 41Z" fill="#4e8548"/><path d="m61 60 18-26 27 41H61Z" fill="#008c95"/><path d="M61 82c37-21-25-19 4-35" fill="none" stroke="#e7a928" strokeWidth="11"/></>,
  boat: <><path d="M22 68h82L89 83H35Z" fill="#e95070"/><path d="M56 36 32 61h24Z" fill="#fffaf0"/><path d="m69 38 21 23H69Z" fill="#e7a928"/><path d="M20 90q14-7 28 0t28 0t28 0v8H20Z" fill="#008c95"/></>,
  huts: <><path d="M16 79V51l15-12 15 12v28Z" fill="#e95070"/><path d="M49 79V42l15-12 15 12v37Z" fill="#e7a928"/><path d="M82 79V51l15-12 15 12v28Z" fill="#008c95"/><path d="M25 79V61h12v18m21 0V52h12v27m21 0V61h12v18" fill="#fffaf0"/></>,
  promenade: <><path d="M30 49h48v7H30Z" fill="#e95070"/><path d="M88 36q-20-8-24 7 13-7 24-7m0 0q18-14 27 0-17-4-27 0m0 0q-4-18-16-16 9 6 16 16" fill="#4e8548"/><path d="M24 91q14-7 28 0t28 0t28 0v7H24Z" fill="#008c95"/></>,
  wine: <><path d="M49 29h32l-3 26a13 13 0 0 1-26 0Z" fill="#fffaf0"/><path d="M51 43h28l-1 12a13 13 0 0 1-26 0Z" fill="#e95070"/><circle cx="32" cy="63" r="4" fill="#2855a6"/><circle cx="25" cy="68" r="4" fill="#2855a6"/><circle cx="34" cy="72" r="4" fill="#2855a6"/><path d="m92 62 12-22q-18 0-12 22Z" fill="#4e8548"/></>,
  cliff: <><path d="m16 77 28-20 16-28 14 7 13 32 25 10Z" fill="#4e8548"/><path d="m60 29 1 33-18 15H16l28-20Z" fill="#008c95"/><path d="M15 87q14-7 28 0t28 0t28 0v11H15Z" fill="#2855a6"/></>,
  pin: <><path d="M78 48c0 18-23 39-23 39S32 66 32 48a23 23 0 0 1 46 0Z" fill="#e95070"/><path d="M47 39h16v21H47Z" fill="#fffaf0"/><path d="M88 76l10-7 10 4 9-8v19H88Z" fill="#e7a928"/></>,
  home: <><path d="M24 54 64 24l40 30v31H24Z" fill="#4e8548"/><path d="M50 85V60h28v25Z" fill="#fffaf0"/><path d="M64 65c-9-10-21 2 0 16 21-14 9-26 0-16Z" fill="#e95070"/></>,
  family: <><circle cx="50" cy="39" r="10" fill="#e7a928"/><circle cx="78" cy="39" r="10" fill="#008c95"/><circle cx="38" cy="62" r="7" fill="#2855a6"/><circle cx="90" cy="62" r="7" fill="#e95070"/><path d="M33 86c0-18 11-29 23-29s17 10 17 29Z" fill="#008c95"/><path d="M61 86c0-19 8-29 21-29 12 0 22 11 22 29Z" fill="#e7a928"/><path d="M64 60c-8-9-19 2 0 14 19-12 8-23 0-14Z" fill="#e95070"/></>,
  dinner: <><ellipse cx="64" cy="65" rx="37" ry="15" fill="#e7a928"/><ellipse cx="64" cy="62" rx="27" ry="10" fill="#fffaf0"/><path d="M34 79v11m60-11v11M24 37v28m8-28v28m-8-17h8M103 37v53" stroke="#2855a6" strokeWidth="5"/><path d="M54 49q-8-10 0-18m13 18q-8-10 0-18m13 18q-8-10 0-18" fill="none" stroke="#e95070" strokeWidth="3"/></>,
  packing: <><rect x="31" y="43" width="67" height="44" rx="8" fill="#2855a6"/><path d="M49 43V32h30v11" fill="none" stroke="#008c95" strokeWidth="7"/><path d="M64 43v44M31 63h67" stroke="#fffaf0" strokeWidth="4"/><rect x="78" y="24" width="28" height="36" rx="3" fill="#e7a928"/><path d="M84 32h16m-16 8h11" stroke="#fffaf0" strokeWidth="3"/></>,
  plane: <><path d="m17 66 40-8 23-31 10 2-11 32 27 10-4 8-31-4-16 18-9-2 7-20-32 3Z" fill="#008c95"/><path d="M20 88q24-8 44 0t44 0" fill="none" stroke="#2855a6" strokeWidth="4"/></>,
}

export function MarkerIcon({ kind, className, colorful = false }: { kind: ArtKind; className?: string; colorful?: boolean }) {
  return <svg className={className} x="10" y="20" width="108" height="78" viewBox={colorful ? '6 18 116 82' : '10 20 108 78'} aria-hidden="true" {...line}>
    {colorful && <g stroke="none" data-marker-fill={kind}>{markerFills[kind]}</g>}
    {kind === 'mountain' && <><path d="M15 78h95M20 73 37 47h12l9-17h34l10 43M58 30h34M36 48l-7 25m54-43 10 43M69 30l-5 43M70 42h18l-9 9Zm9 9v13"/></>}
    {kind === 'penguin' && <><path d="M43 72c-5-22 1-39 15-39s20 17 15 39M43 50 32 64m41-14 11 14M48 76l-9 4m27-4 9 4"/><ellipse cx="58" cy="59" rx="9" ry="15"/><path d="m53 44 5 4 5-4"/><circle cx="52" cy="40" r="1.4"/><circle cx="64" cy="40" r="1.4"/><path d="M82 73c-3-14 1-25 11-25s14 11 11 25M84 59l-7 8m25-8 7 8m-21 10-6 3m17-3 6 3m-16-24 4 3 4-3"/><circle cx="89" cy="53" r="1"/><circle cx="97" cy="53" r="1"/></>}
    {kind === 'house' && <path d="M24 79V45l15-10 15 10v34m0 0V38l16-9 16 9v41m0 0V50l15-9 14 9v29M20 79h100M35 79V61h9v18M66 79V58h9v21M95 79V64h9v15M33 48h12m19-6h13m18 11h10"/>}
    {kind === 'cape' && <><path d="m32 37 25 8-9 13 22 7-4 10 24 6M30 82q12-9 24 0t24 0t24 0M80 36v21m-7-14 7-7 7 7"/><circle cx="33" cy="36" r="4"/></>}
    {kind === 'lighthouse' && <path d="m50 78 6-29h16l6 29M48 79h33M55 49V39h19v10M52 39l12-9 13 9M60 58h9M41 43l-15 3m60-3 14 3M25 85q12-7 24 0t24 0t24 0"/>}
    {kind === 'road' && <path d="M17 75 39 43l22 17 18-26 27 41M61 82c37-21-25-19 4-35M21 84h21m42 0h18"/>}
    {kind === 'boat' && <path d="M22 68h82L89 83H35ZM62 32v36M56 36 32 61h24m13-23 21 23H69M20 90q14-7 28 0t28 0t28 0"/>}
    {kind === 'huts' && <path d="M16 79V51l15-12 15 12v28m3 0V42l15-12 15 12v37m3 0V51l15-12 15 12v28M25 79V61h12v18m21 0V52h12v27m21 0V61h12v18M12 84h105"/>}
    {kind === 'promenade' && <path d="M16 77h100M30 49h48v7H30zm4 7v21m38-21v21M88 78V34m-7 0h14M24 91q14-7 28 0t28 0t28 0"/>}
    {kind === 'wine' && <><path d="M49 29h32l-3 26a13 13 0 0 1-26 0ZM52 43h25M65 68v18m-12 0h24M21 72l18-24m51 18 14-26"/><circle cx="32" cy="63" r="4"/><circle cx="25" cy="68" r="4"/><circle cx="34" cy="72" r="4"/></>}
    {kind === 'cliff' && <path d="m16 77 28-20 16-28 14 7 13 32 25 10M59 31l2 31-18 15M76 51l-2 21M15 87q14-7 28 0t28 0t28 0"/>}
    {kind === 'pin' && <><path d="M78 48c0 18-23 39-23 39S32 66 32 48a23 23 0 0 1 46 0Z"/><path d="M47 39h16v21H47zm5 0v-6h7v6M88 76l10-7 10 4 9-8M88 84h29"/></>}
    {kind === 'home' && <><path d="M20 55 64 22l44 33M28 50v38h72V50M51 88V61h26v27"/><path d="M64 67c-8-10-21 2 0 15 21-13 8-25 0-15Z"/></>}
    {kind === 'family' && <><circle cx="50" cy="38" r="9"/><circle cx="79" cy="38" r="9"/><circle cx="37" cy="64" r="6"/><circle cx="92" cy="64" r="6"/><path d="M24 88c1-21 13-32 27-32 9 0 14 5 18 13m35 19c-1-21-13-32-27-32-9 0-14 5-18 13"/><path d="M64 61c-8-9-19 2 0 14 19-12 8-23 0-14Z"/></>}
    {kind === 'dinner' && <><ellipse cx="64" cy="65" rx="37" ry="15"/><ellipse cx="64" cy="62" rx="27" ry="10"/><path d="M34 79v11m60-11v11M24 36v31m8-31v31m-8-17h8m71-14v54M54 49q-8-10 0-18m13 18q-8-10 0-18m13 18q-8-10 0-18"/></>}
    {kind === 'packing' && <><rect x="31" y="43" width="67" height="44" rx="8"/><path d="M49 43V32h30v11M64 43v44M31 63h67"/><rect x="78" y="24" width="28" height="36" rx="3"/><path d="M84 32h16m-16 8h11"/></>}
    {kind === 'plane' && <><path d="m17 66 40-8 23-31 10 2-11 32 27 10-4 8-31-4-16 18-9-2 7-20-32 3ZM20 88q24-8 44 0t44 0"/></>}
  </svg>
}

export function PlaceScene({ name, className = 'landscape' }: { name: string; className?: string }) {
  const kind = artKindFor(name)
  const sceneKind: StampKind = kind === 'home' || kind === 'family' || kind === 'dinner' || kind === 'packing' || kind === 'plane' ? 'pin' : kind
  return <SceneIllustration kind={sceneKind} className={className}/>
}

export function PlaceThumbnail({ name }: { name: string }) {
  const kind = artKindFor(name)
  return <svg className="place-thumbnail" data-thumbnail={kind} viewBox="0 0 128 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" style={{ color: '#23455b' }}>
    <MarkerIcon kind={kind} colorful/>
  </svg>
}

export function stampTextLines(name: string, fontSize = 10): string[] {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.toUpperCase())].map(part => part.segment)
  // Conservative Georgia bold advances leave room for font substitution.
  const advance = (text: string) => ( /^\s$/u.test(text) ? 4 : /^[MW]$/.test(text) ? 13 : /^[I.,'!:;|]$/.test(text) ? 5 : /^[A-Z0-9-]$/.test(text) ? 9 : /^\p{L}\p{M}*$/u.test(text) ? 12 : 14 ) * fontSize / 10
  const lines: string[] = []
  let pending: string[] = []
  for (const grapheme of graphemes) {
    while (pending.reduce((sum, text) => sum + advance(text), 0) + advance(grapheme) > 100) {
      const breakAt = pending.findLastIndex(text => /\s/u.test(text))
      const count = breakAt > 0 ? breakAt + 1 : pending.length
      lines.push(pending.splice(0, count).join(''))
    }
    pending.push(grapheme)
  }
  if (pending.length) lines.push(pending.join(''))
  return lines
}

export function stampLayout(name: string) {
  for (const fontSize of [10, 9.5, 9, 8.5, 8, 7.5]) {
    const lines = stampTextLines(name, fontSize)
    const lineHeight = fontSize + 0.5
    const titleBottom = 26 + Math.max(0, lines.length - 1) * lineHeight
    if (titleBottom <= 90 || fontSize === 7.5) {
      const markerTop = titleBottom + 6
      const markerScale = Math.min(0.66, (103 - markerTop) / 78)
      return { lines, fontSize, lineHeight, markerScale, markerTop }
    }
  }
  throw new Error('Unable to lay out travel stamp')
}

export function stampMonthLabel(date?: string): string {
  if (!date) return 'CAPE TOWN'
  const parsedDate = new Date(`${date}T12:00:00Z`)
  const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(parsedDate).toUpperCase()
  return `${month === 'SEP' ? 'SEPT' : month} ${parsedDate.getUTCFullYear()}`
}

export function TravelStamp({ name, date, className = '', stampKind }: { name: string; date?: string; className?: string; stampKind?: StampDesign }) {
  const kind = !stampKind || stampKind === 'auto' ? artKindFor(name) : stampKind
  const color = colorForKind(kind)
  const { lines, fontSize, lineHeight, markerScale, markerTop } = stampLayout(name)
  const dateLabel = stampMonthLabel(date)
  return <svg className={className} viewBox="0 0 128 129" role="img" aria-label={`${name} travel stamp, ${dateLabel}`} style={{ color }} data-safe-stamp="" data-stamp-kind={kind}>
    <rect x="4" y="6" width="120" height="117" rx="9" fill="#fff4de" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3"/>
    <rect data-inner-border="" x="10" y="12" width="108" height="105" rx="6" fill="none" stroke="currentColor" strokeWidth="1.6"/>
    <text className="stamp-name" x="64" y="26" fill="currentColor" textAnchor="middle" fontFamily="Georgia,serif" fontWeight="bold" fontSize={fontSize} xmlSpace="preserve">
      {lines.map((text, index) => <tspan x="64" dy={index === 0 ? 0 : lineHeight} key={index}>{text}</tspan>)}
    </text>
    <g data-stamp-marker="" transform={`translate(${64 - 64 * markerScale} ${markerTop - 20 * markerScale + (103 - markerTop - 78 * markerScale) / 2}) scale(${markerScale})`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><MarkerIcon kind={kind}/></g>
    <text className="stamp-month" x="64" y="112" fill="currentColor" textAnchor="middle" fontFamily="sans-serif" fontSize="7.4" fontWeight="bold" letterSpacing="1.1">{dateLabel}</text>
  </svg>
}

const paths: Record<string, ReactNode> = {
  itinerary: <><rect x="4" y="6" width="24" height="23" rx="3"/><path d="M4 13h24M10 3v6m12-6v6m-12 9h4m4 0h4m-12 5h4"/></>,
  places: <><path d="M25 12c0 7-9 16-9 16S7 19 7 12a9 9 0 0 1 18 0Z"/><circle cx="16" cy="12" r="3"/></>,
  moments: <><path d="M9 13h14v5H9zM12 12V7a4 4 0 0 1 8 0v5M6 23h20v4H6z"/></>,
  checklist: <><rect x="5" y="4" width="23" height="25" rx="3"/><path d="m9 11 2 2 3-4m-5 12 2 2 3-4M18 11h6m-6 10h6"/></>,
  costs: <><circle cx="16" cy="16" r="12"/><path d="M21 10h-7a4 4 0 0 0 0 8h4a3 3 0 0 1 0 6h-7m5-18v20"/></>,
  camera: <><rect x="3" y="8" width="26" height="19" rx="3"/><path d="m10 8 2-4h8l2 4"/><circle cx="16" cy="17" r="6"/></>,
  save: <><path d="M6 4h17l5 5v19H4V4h2Z"/><path d="M10 4v9h12V4M9 28V18h14v10M18 5v5"/></>,
  trash: <><path d="M5 8h22M12 8V4h8v4M8 8l2 20h12l2-20M13 13v10m6-10v10"/></>,
  download: <><path d="M16 4v17m-6-6 6 6 6-6M6 22v6h20v-6"/></>,
  restore: <><path d="M6 12a11 11 0 1 1-1 11M6 5v8h8"/><path d="M16 10v7l5 3"/></>,
  people: <><circle cx="12" cy="11" r="5"/><circle cx="23" cy="13" r="4"/><path d="M3 28c0-6 4-10 9-10s9 4 9 10M19 20c5 0 9 3 9 8"/></>,
}

export function LineIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function EmptyDayArt() {
  return <svg className="empty-illustration" viewBox="0 0 140 80" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="103" cy="19" r="12" fill="#e7a928" stroke="none"/><path d="m13 61 27-34h32l23 34M7 66q23-10 46 0t46 0t35 0"/><path d="m37 17 5 3 5-3m22-7 5 3 5-3" strokeLinecap="round"/></svg>
}
