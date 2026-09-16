import 'fake-indexeddb/auto'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync, writeFileSync } from 'node:fs'

const output = process.argv[2]
if (!output) throw new Error('Pass an output HTML path outside the production assets.')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { MomentPostcard, PostcardStamp } = await vite.ssrLoadModule('/src/MomentPostcard.tsx')
  const { PlaceScene } = await vite.ssrLoadModule('/src/Artwork.tsx')
  const { checkPostcardLayout } = await vite.ssrLoadModule('/dev/check-postcard-layout.ts')
  const { db, initializeDatabase } = await vite.ssrLoadModule('/src/db.ts')
  await initializeDatabase()
  const known = (await db.places.toArray()).map(place => place.name)
  db.close()
  const names = [...new Set([
    'New Cape Point Lighthouse', 'Boulders Penguin Colony', 'W'.repeat(90), '海'.repeat(90), '🌊'.repeat(45),
    'Café, São Tomé & Kaapstad — 海辺の散歩 🌊 e\u0301',
    'A very long custom Cape Town activity name with punctuation, viewpoints and picnic plans!!', ...known,
  ])]
  const image = 'data:image/svg+xml,' + encodeURIComponent(renderToStaticMarkup(createElement(PlaceScene, { name: 'Muizenberg Beach' })).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))
  const cards = names.flatMap(name => [false, true].map(photo => renderToStaticMarkup(createElement(MomentPostcard, {
    name, date: '2026-09-25', caption: 'Preview sample', photo: photo ? createElement('img', { src: image, alt: 'Generated image' }) : undefined, onOpen: () => {},
  })))).join('')
  const detached = names.map(name => renderToStaticMarkup(createElement(PostcardStamp, { name, date: '2026-09-25' }))).join('')
  const css = readFileSync('src/MomentPostcard.css', 'utf8')
  const js = `window.verifyPostcards=()=>{
    const root=document.querySelector('#fixture');const check=${checkPostcardLayout.toString()};const results=[];
    for(const width of [260,288,358,398,488]){
      root.style.width=width+'px';
      results.push({width,stamps:root.querySelectorAll('[data-safe-stamp]').length,failures:check(root)});
    }
    root.style.width='358px';return {results};
  };`
  writeFileSync(output, `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:16px;background:#fff4de}#fixture{width:358px}.detached-memory{display:grid;gap:20px}${css}</style><div id="fixture"><div class="postcards">${cards}</div><div class="detached-memory">${detached}</div></div><script>${js}</script>`)
} finally {
  await vite.close()
}
