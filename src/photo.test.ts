import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressPhoto } from './photo'

afterEach(() => vi.unstubAllGlobals())

describe('photo compression', () => {
  it('rejects unsupported formats visibly', async () => {
    await expect(compressPhoto(new File(['heic'], 'photo.heic', { type:'image/heic' }))).rejects.toThrow('JPEG, PNG or WebP')
  })

  it('caps the long edge at 1600px and output near 1 MB', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width:3200, height:2400, close:vi.fn() }))
    const context = { drawImage: vi.fn() }
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob([new Uint8Array(900_000)], { type:'image/jpeg' })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)
    const result = await compressPhoto(new File(['image'], 'photo.png', { type:'image/png' }))
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
    expect(result.blob.size).toBeLessThanOrEqual(1_100_000)
  })
})
