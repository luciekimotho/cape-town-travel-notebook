import { StrictMode, useState, type ComponentProps, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { EmptyDayArt, LineIcon, MarkerIcon, PlaceScene, PlaceThumbnail, TravelStamp, type ArtKind } from '../src/Artwork'
import { MomentPostcard, PostcardStamp } from '../src/MomentPostcard'
import './asset-gallery.css'

const lineIcons: ComponentProps<typeof LineIcon>['name'][] = [
  'itinerary', 'places', 'moments', 'checklist', 'costs',
  'camera', 'save', 'trash', 'download', 'restore', 'people',
]

const artSamples: Array<{ kind: ArtKind; name: string }> = [
  { kind:'mountain', name:'Table Mountain' },
  { kind:'penguin', name:'Boulders Penguin Colony' },
  { kind:'house', name:'Bo-Kaap' },
  { kind:'cape', name:'Cape Peninsula Tour' },
  { kind:'lighthouse', name:'New Cape Point Lighthouse' },
  { kind:'road', name:"Chapman's Peak Drive" },
  { kind:'boat', name:'V&A Waterfront' },
  { kind:'huts', name:'Muizenberg Beach' },
  { kind:'promenade', name:'Sea Point Promenade' },
  { kind:'wine', name:'Winelands Tasting' },
  { kind:'cliff', name:'Cape of Good Hope' },
  { kind:'pin', name:'Neutral place fallback' },
]

const colors = [
  ['Bo-Kaap pink', '#bc3557'],
  ['Cape mustard', '#e7a928'],
  ['Atlantic teal', '#008c95'],
  ['Postcard blue', '#2855a6'],
  ['Fynbos green', '#4e8548'],
  ['Notebook ink', '#28262a'],
  ['Paper', '#fff4de'],
] as const

const postcardSamples = [
  'Bo-Kaap',
  'New Cape Point Lighthouse',
  'Boulders Penguin Colony',
  'Muizenberg Beach',
]

function Gallery() {
  const [selectedPostcard, setSelectedPostcard] = useState<string>()
  return <main className="guide">
    <header className="masthead">
      <div className="facades" aria-hidden="true">{colors.slice(0,5).map(([, color])=><i key={color} style={{background:color}}/>)}</div>
      <div className="masthead-copy"><p>Production artwork inventory · 16 September 2026</p><h1>Cape Town<br/><em>Field Guide</em></h1><span>Every mark below is rendered from the current app source.</span></div>
    </header>

    <section className="chapter" id="identity">
      <ChapterNumber value="01"/><div className="chapter-heading"><p>Identity</p><h2>App icons & wordmark</h2></div>
      <div className="identity-grid">
        <article className="wordmark"><div className="production-header"><strong>Capetown 2026</strong><span>21–28 September</span></div><p>Current compact header treatment</p></article>
        <article className="icon-scale"><h3>Active favicon · <code>icon.svg</code></h3><div>{[16,32,64,128].map(size=><figure key={size}><img src="/cape-town-travel-notebook/icon.svg" width={size} height={size}/><figcaption>{size}px</figcaption></figure>)}</div></article>
        <article className="install-icons"><h3>Installed PWA icons</h3><div><figure><img src="/cape-town-travel-notebook/icon-192.png"/><figcaption>icon-192.png</figcaption></figure><figure><img src="/cape-town-travel-notebook/icon-512.png"/><figcaption>icon-512.png</figcaption></figure></div></article>
      </div>
      <p className="note">The browser favicon is the branded <code>icon.svg</code>. The removed <code>favicon.svg</code> was an unused Vite starter asset.</p>
    </section>

    <section className="chapter">
      <ChapterNumber value="02"/><div className="chapter-heading"><p>Navigation & actions</p><h2>Line icon set</h2></div>
      <div className="line-grid">{lineIcons.map(name=><article key={name}><LineIcon name={name}/><span>{name}</span></article>)}</div>
    </section>

    <section className="chapter scenes" id="scenes">
      <ChapterNumber value="03"/><div className="chapter-heading"><p>Destination illustrations</p><h2>All scene families</h2></div>
      <p className="note">Wide postcard scenes stay in the details and memories. Narrow cards now use colored line illustrations, shown here at 56 × 76px beside their original line symbols. No landscape cropping.</p>
      <div className="scene-grid">{artSamples.map(({kind,name}, index)=><article key={kind} style={{'--delay':`${index*35}ms`} as CSSProperties}><PlaceScene name={name}/><footer><span>{String(index+1).padStart(2,'0')}</span><div><strong>{name}</strong><small>{kind}{kind==='pin'?' · neutral fallback':''}</small></div><div className="scene-mini"><PlaceThumbnail name={name}/><MarkerIcon kind={kind}/></div></footer></article>)}</div>
    </section>

    <section className="chapter">
      <ChapterNumber value="04"/><div className="chapter-heading"><p>Passport memories</p><h2>Safe-area postage stamps</h2></div>
      <div className="stamp-grid">{artSamples.map(({kind,name})=><figure key={kind}><div className="stamp-pair"><TravelStamp name={name} date="2026-09-25"/></div></figure>)}</div>
    </section>

    <section className="chapter" id="postcards">
      <ChapterNumber value="05"/><div className="chapter-heading"><p>Preview samples</p><h2>Moments</h2></div>
      <div className="postcard-review">
        <div className="postcards">{postcardSamples.map(name => <MomentPostcard key={name} name={name} date="2026-09-25" caption="" onOpen={() => setSelectedPostcard(name)}/>)}</div>
        {selectedPostcard && <div className="postcard-inspection"><PostcardStamp name={selectedPostcard} date="2026-09-25"/><button onClick={() => setSelectedPostcard(undefined)}>Close preview</button></div>}
      </div>
    </section>

    <section className="chapter utility">
      <ChapterNumber value="06"/><div className="chapter-heading"><p>Supporting system</p><h2>Palette, type & empty state</h2></div>
      <div className="support-grid">
        <article className="palette">{colors.map(([name,color])=><div key={name}><i style={{background:color}}/><span><strong>{name}</strong><code>{color}</code></span></div>)}</article>
        <article className="type-card"><span>Display · Georgia</span><h3>A little room<br/>to explore.</h3><p>Body · Nunito Sans / Avenir Next</p><p>Travel days, handwritten details and practical plans.</p></article>
        <article className="empty-card"><EmptyDayArt/><h3>A little room to explore.</h3><p>Current itinerary empty-state artwork</p></article>
      </div>
    </section>

    <footer className="colophon">Review-only dev gallery · excluded from the production entry and navigation</footer>
  </main>
}

function ChapterNumber({ value }: { value: string }) {
  return <span className="chapter-number" aria-hidden="true">{value}</span>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Gallery/></StrictMode>)
