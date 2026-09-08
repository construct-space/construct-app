export const CHROME_H = 80
const CHROME_PAD = 0

type Point = { x: number; y: number }
type RectLike = { left: number; top: number; width: number; height: number }
type Viewport = { width: number; height: number }

export function deriveNativeInsets(input: {
  fullscreen: boolean
  scaleFactor: number
  outerPosition: Point
  innerPosition: Point
}): Point {
  if (input.fullscreen) {
    return { x: 0, y: 0 }
  }

  const factor = input.scaleFactor > 0 ? input.scaleFactor : 1
  return {
    x: Math.max(0, Math.round((input.innerPosition.x - input.outerPosition.x) / factor)),
    y: Math.max(0, Math.round((input.innerPosition.y - input.outerPosition.y) / factor)),
  }
}

export function computeContentBounds(input: {
  rect: RectLike
  viewport: Viewport
  chromeHeight: number
  nativeInsets: Point
}) {
  const x = input.rect.left > 0
    ? Math.round(input.rect.left + input.nativeInsets.x)
    : Math.round(input.nativeInsets.x)
  const yBase = input.rect.top > 0 ? input.rect.top : input.chromeHeight
  const y = Math.round(yBase + input.nativeInsets.y + CHROME_PAD)
  const heightBase = input.rect.height > 0
    ? Math.round(input.rect.height)
    : Math.round(input.viewport.height - input.chromeHeight)
  const height = Math.max(1, heightBase - CHROME_PAD)

  return {
    x,
    y,
    width: Math.max(1, Math.round(input.rect.width || input.viewport.width)),
    height,
  }
}
