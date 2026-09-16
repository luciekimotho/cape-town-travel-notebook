export function checkPostcardLayout(root: ParentNode): string[] {
  const failures: string[] = []
  const inside = (rect: DOMRect, frame: DOMRect, inset: number) =>
    rect.left >= frame.left + inset - 0.5 && rect.right <= frame.right - inset + 0.5 &&
    rect.top >= frame.top + inset - 0.5 && rect.bottom <= frame.bottom - inset + 0.5
  for (const stamp of root.querySelectorAll<SVGSVGElement>('[data-safe-stamp]')) {
    const frame = stamp.querySelector<SVGRectElement>('[data-inner-border]')!.getBBox()
    const name = stamp.querySelector<SVGTextElement>('.stamp-name')!
    const label = name.textContent ?? ''
    if (stamp.getAttribute('viewBox') !== '0 0 128 129') failures.push(`Inconsistent stamp size: ${label}`)
    if (parseFloat(getComputedStyle(name).fontSize) < 7.5) failures.push(`Type too small: ${label}`)
    for (const text of stamp.querySelectorAll<SVGGraphicsElement>('tspan, .stamp-month')) {
      const box = text.getBBox()
      if (box.x < frame.x + 3 || box.x + box.width > frame.x + frame.width - 3 ||
          box.y < frame.y + 3 || box.y + box.height > frame.y + frame.height - 3) failures.push(`Text crosses inner border: ${label} (${box.x}, ${box.y}, ${box.width}, ${box.height})`)
    }
    const marker = stamp.querySelector('[data-stamp-marker]')!.getBoundingClientRect()
    if (name.getBoundingClientRect().bottom > marker.top) failures.push(`Overlapping name and marker: ${label}`)
    if (marker.bottom > stamp.querySelector('.stamp-month')!.getBoundingClientRect().top) failures.push(`Overlapping marker and month: ${label}`)
    if (/visited/i.test(stamp.textContent ?? '')) failures.push(`Unexpected visited label: ${label}`)
  }
  for (const card of root.querySelectorAll<HTMLElement>('.postcard')) {
    if (card.scrollWidth > card.clientWidth) failures.push('Postcard overflow')
    const caption = card.querySelector('.postcard-caption')
    if (caption) {
      const range = document.createRange()
      range.selectNodeContents(caption)
      for (const rect of range.getClientRects()) {
        if (!inside(rect, card.getBoundingClientRect(), 1)) failures.push('Caption outside postcard')
      }
    }
  }
  return failures
}
