export const stampKinds = ['mountain', 'penguin', 'house', 'cape', 'lighthouse', 'road', 'boat', 'huts', 'promenade', 'wine', 'cliff', 'pin'] as const
export type StampKind = typeof stampKinds[number]
export type StampDesign = StampKind | 'auto'

export function isStampDesign(value: unknown): value is StampDesign {
  return value === 'auto' || stampKinds.some(kind => kind === value)
}

export function validateStampDesign(value: unknown): void {
  if (value !== undefined && !isStampDesign(value)) throw new Error('Invalid stamp design.')
}

export function validateNotebookStampDesigns(data: {
  places: readonly { stampKind?: StampDesign }[]
  items: readonly { stampKind?: StampDesign }[]
  activityTemplates: readonly { stampKind?: StampDesign }[]
  stamps: readonly { stampKind?: StampDesign }[]
}): void {
  for (const rows of [data.places, data.items, data.activityTemplates, data.stamps]) {
    for (const row of rows) validateStampDesign(row.stampKind)
  }
}
