const supported = new Set(['image/jpeg', 'image/png', 'image/webp'])
export async function compressPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!supported.has(file.type)) throw new Error('Choose a JPEG, PNG or WebP image. HEIC is not supported.')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('This image could not be decoded. Choose a JPEG, PNG or WebP image.') }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image processing is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close()
  for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= 1_100_000) return { blob, width, height }
  }
  throw new Error('The image could not be compressed to about 1 MB. Try a smaller JPEG, PNG or WebP image.')
}
