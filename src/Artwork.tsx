import type { ReactNode } from 'react'

export type ArtKind = 'mountain' | 'penguin' | 'house' | 'cape' | 'lighthouse' | 'road' | 'boat' | 'huts' | 'promenade' | 'wine' | 'cliff' | 'pin'

const normalized = (name: string) => name.toLowerCase()

export function artKindFor(name: string): ArtKind {
  const value = normalized(name)
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
  if (kind === 'house') return '#bc3557'
  if (kind === 'penguin' || kind === 'cape' || kind === 'promenade') return '#2855a6'
  if (kind === 'lighthouse' || kind === 'cliff') return '#315f2e'
  if (kind === 'road' || kind === 'huts') return '#8b5700'
  return '#006b72'
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function MarkerIcon({ kind, className }: { kind: ArtKind; className?: string }) {
  return <svg className={className} x="10" y="20" width="108" height="78" viewBox="10 20 108 78" aria-hidden="true" {...line}>
    {kind === 'mountain' && <><path d="M20 73 37 47h47l18 26M36 48l-7 25m54-25 10 25M15 78h95M49 41h27"/></>}
    {kind === 'penguin' && <><path d="M48 72c-6-21-1-38 14-38s20 17 14 38M48 50l-9 15m37-15 9 15M51 75l-8 4m30-4 8 4"/><ellipse cx="62" cy="60" rx="9" ry="15"/><path d="m58 44 4 4 4-4"/><circle cx="57" cy="40" r="1"/><circle cx="67" cy="40" r="1"/></>}
    {kind === 'house' && <path d="M24 79V45l15-10 15 10v34m0 0V38l16-9 16 9v41m0 0V50l15-9 14 9v29M20 79h100M35 79V61h9v18M66 79V58h9v21M95 79V64h9v15M33 48h12m19-6h13m18 11h10"/>}
    {kind === 'cape' && <><path d="m32 37 25 8-9 13 22 7-4 10 24 6M30 82q12-9 24 0t24 0t24 0M80 36v21m-7-14 7-7 7 7"/><circle cx="33" cy="36" r="4"/></>}
    {kind === 'lighthouse' && <path d="m50 78 6-29h16l6 29M48 79h33M55 49V39h19v10M52 39l12-9 13 9M60 58h9M41 43l-15 3m60-3 14 3M25 85q12-7 24 0t24 0t24 0"/>}
    {kind === 'road' && <path d="M17 75 39 43l22 17 18-26 27 41M61 82c37-21-25-19 4-35M21 84h21m42 0h18"/>}
    {kind === 'boat' && <path d="M22 68h82L89 83H35ZM62 32v36M56 36 32 61h24m13-23 21 23H69M20 90q14-7 28 0t28 0t28 0"/>}
    {kind === 'huts' && <path d="M16 79V51l15-12 15 12v28m3 0V42l15-12 15 12v37m3 0V51l15-12 15 12v28M25 79V61h12v18m21 0V52h12v27m21 0V61h12v18M12 84h105"/>}
    {kind === 'promenade' && <path d="M16 77h100M30 49h48v7H30zm4 7v21m38-21v21M88 78V34m-7 0h14M24 91q14-7 28 0t28 0t28 0"/>}
    {kind === 'wine' && <><path d="M49 29h32l-3 26a13 13 0 0 1-26 0ZM52 43h25M65 68v18m-12 0h24M21 72l18-24m51 18 14-26"/><circle cx="32" cy="63" r="4"/><circle cx="25" cy="68" r="4"/><circle cx="34" cy="72" r="4"/></>}
    {kind === 'cliff' && <path d="m16 77 28-20 16-28 14 7 13 32 25 10M59 31l2 31-18 15M76 51l-2 21M15 87q14-7 28 0t28 0t28 0"/>}
    {kind === 'pin' && <><path d="M78 48c0 18-23 39-23 39S32 66 32 48a23 23 0 0 1 46 0Z"/><circle cx="55" cy="48" r="8"/></>}
  </svg>
}

export function PlaceScene({ name, className = 'landscape' }: { name: string; className?: string }) {
  const kind = artKindFor(name)
  const water = <><path d="M0 98q65-13 130 0t130 0t130 0v52H0" fill="#008c95"/><path d="M0 127q65-9 130 0t130 0t130 0" fill="none" stroke="#fff4de" opacity=".65"/></>
  return <svg className={className} viewBox="0 0 350 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="350" height="150" fill={kind === 'house' ? '#f5dec7' : '#dce9e1'}/><circle cx="274" cy="33" r="21" fill="#e7a928"/>
    {kind === 'penguin' && <>{water}<path d="M0 135q90-49 175-10t175-14v39H0" fill="#e6d1a8"/><ellipse cx="145" cy="110" rx="47" ry="14" fill="#b8ad93"/><g fill="#28262a"><ellipse cx="175" cy="88" rx="23" ry="40"/><ellipse cx="208" cy="104" rx="16" ry="28"/></g><g fill="#fffaf0"><ellipse cx="176" cy="94" rx="14" ry="28"/><ellipse cx="209" cy="107" rx="10" ry="20"/><circle cx="183" cy="65" r="2"/></g><path d="m193 68 12 4-12 4m28 19 9 4-9 3M165 126h13m26 5h12" stroke="#bc6a2c" strokeWidth="4" strokeLinecap="round"/></>}
    {kind === 'lighthouse' && <>{water}<path d="m105 140 39-37 49 2 40 35" fill="#577762"/><path d="m159 112 7-69h22l9 69" fill="#fffaf0"/><path d="M165 70h25l2 13h-28" fill="#e95070"/><path d="M162 43V28h29v15" fill="#2855a6"/><path d="m156 28 21-15 21 15" fill="#bc3557"/><path d="M173 31h9v9M173 94h9v17" fill="#fff4de"/><path d="m156 34-34 11m77-11 34 11" stroke="#e7a928" strokeWidth="4"/></>}
    {kind === 'huts' && <>{water}<path d="M0 124q90-15 170 2t180-4v28H0" fill="#ead5ae"/><g stroke="#fff4de" strokeWidth="2"><path d="M93 111V61l23-15 23 15v50" fill="#e95070"/><path d="M139 111V61l23-15 23 15v50" fill="#e7a928"/><path d="M185 111V61l23-15 23 15v50" fill="#2855a6"/><path d="M231 111V61l23-15 23 15v50" fill="#008c95"/></g><g fill="#fff4de"><path d="M108 111V78h16v33m30 0V78h16v33m30 0V78h16v33m30 0V78h16v33"/></g></>}
    {kind === 'road' && <>{water}<path d="M0 150V95l71-74 54 59 49-50 75 120" fill="#80936b"/><path d="m174 30 13 120H80l45-70" fill="#577762"/><path d="M215 150c-79-46-4-38-67-64s-20-39-20-39" fill="none" stroke="#f5eedc" strokeWidth="13"/><path d="M215 150c-79-46-4-38-67-64s-20-39-20-39" fill="none" stroke="#8b5700" strokeWidth="1.5" strokeDasharray="4 5"/></>}
    {kind === 'boat' && <>{water}<path d="m122 104 105-2-17 22h-72" fill="#bc3557"/><path d="M175 37v65" stroke="#28262a" strokeWidth="3"/><path d="m167 44-39 48h39" fill="#fffaf0"/><path d="m183 50 32 42h-32" fill="#e7a928"/><path d="M28 93V68h55v25" fill="#e7a928"/><path d="m23 68 33-19 32 19" fill="#2855a6"/></>}
    {kind === 'promenade' && <>{water}<path d="M0 107h350v16H0" fill="#e6d1a8"/><path d="M112 81h71v8h-71m7 0v18m56-18v18" fill="none" stroke="#315f2e" strokeWidth="5"/><path d="M225 106V40m-7 0h14" fill="none" stroke="#2855a6" strokeWidth="4"/><circle cx="225" cy="33" r="7" fill="#fffaf0"/></>}
    {kind === 'wine' && <><path d="m0 99 72-38 70 39 52-33 65 30 91-36v89H0" fill="#80936b"/><path d="M0 150 125 99m-50 51 74-49m20 49 12-48m84 48-59-48m131 48-107-48" stroke="#315f2e" strokeWidth="8"/><path d="M155 22h39l-4 41a16 16 0 0 1-31 0Z" fill="#fffaf0"/><path d="M159 48h31l-3 18a13 13 0 0 1-25 0" fill="#bc3557"/><path d="M175 82v32m-16 0h32" stroke="#fffaf0" strokeWidth="4" strokeLinecap="round"/></>}
    {kind === 'cliff' && <>{water}<path d="m34 141 65-29 43-35 26-50 23 11 43 88 59 15" fill="#80936b"/><path d="m168 27 3 69-41 32-96 13 65-29 43-35" fill="#577762"/><path d="m191 38-5 42 32 39" fill="none" stroke="#c1cda2" strokeWidth="3"/></>}
    {kind === 'house' && <><path d="M20 140V55h80v85" fill="#e95070"/><path d="M100 140V30h78v110" fill="#008c95"/><path d="M178 140V60h72v80" fill="#e7a928"/><path d="M250 140V44h70v96" fill="#2855a6"/><g fill="#fff4de"><path d="M45 75h23v28H45zm80-22h23v28h-23zm77 28h23v28h-23zm71-16h23v28h-23z"/></g></>}
    {kind === 'cape' && <><path d="M0 60q85 14 155 0t195 0v90H0" fill="#008c95"/><path d="M0 30h96l37 26-15 24 45 12 26 28-35 16-63-22-9-26L0 100Z" fill="#819a6a"/><path d="m13 37 64 19 27 11-8 21 42 16 25 16" fill="none" stroke="#fff4de" strokeWidth="4" strokeLinecap="round"/><path d="m245 91 30-29v29zm7 5h47l-9 8h-33z" fill="#fff4de"/></>}
    {(kind === 'mountain' || kind === 'pin') && <><path d="m0 117 40-27 33 7 44-60h95l40 60 41-26 57 46v33H0" fill="#7d9b84"/><path d="m73 112 44-75h95l-21 75Z" fill="#577762"/><path d="M0 126q70-15 140 0t140 0t140 0v24H0" fill="#008c95"/></>}
  </svg>
}

export function TravelStamp({ name, date, className = '' }: { name: string; date?: string; className?: string }) {
  const kind = artKindFor(name)
  const color = colorForKind(kind)
  const label = name.toUpperCase().slice(0, 23)
  const parsedDate = date ? new Date(`${date}T12:00:00Z`) : undefined
  const dateLabel = parsedDate ? `${parsedDate.getUTCDate()} ${new Intl.DateTimeFormat('en', { month:'short', timeZone:'UTC' }).format(parsedDate).toUpperCase()} ${parsedDate.getUTCFullYear()}` : 'CAPE TOWN'
  const rectangular = kind === 'house' || kind === 'road'
  return <svg className={className} viewBox="0 0 128 128" role="img" aria-label={`${name} travel stamp`} style={{ color }}>
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {rectangular ? <><rect x="5" y="9" width="118" height="110" rx="8" strokeDasharray="3 4"/><rect x="10" y="14" width="108" height="100" rx="5"/></> : <><circle cx="64" cy="64" r="59" strokeDasharray="3 3"/><circle cx="64" cy="64" r="54"/></>}
      <g transform="translate(0 2)"><MarkerIcon kind={kind}/></g><path d="M31 88h66"/>
    </g>
    <g fill="currentColor" textAnchor="middle" fontFamily="Georgia,serif" fontWeight="bold">
      <text x="64" y="28" fontSize={label.length > 15 ? 7.5 : 9}>{label}</text>
      <text x="64" y="100" fontFamily="sans-serif" fontSize="7" letterSpacing="1.2">{dateLabel}</text>
      <text x="64" y="110" fontFamily="sans-serif" fontSize="5.5" letterSpacing="1.3">{date ? 'VISITED' : 'SOUTH AFRICA'}</text>
    </g>
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
}

export function LineIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function EmptyDayArt() {
  return <svg className="empty-illustration" viewBox="0 0 140 80" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="103" cy="19" r="12" fill="#e7a928" stroke="none"/><path d="m13 61 27-34h32l23 34M7 66q23-10 46 0t46 0t35 0"/><path d="m37 17 5 3 5-3m22-7 5 3 5-3" strokeLinecap="round"/></svg>
}
