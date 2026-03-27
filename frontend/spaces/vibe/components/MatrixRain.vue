<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const canvasRef = ref<HTMLCanvasElement>()
let animId = 0
let removeResize: (() => void) | null = null

onMounted(() => {
  const canvas = canvasRef.value!
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  if (!ctx) return

  // Read accent color from CSS variable
  const style = getComputedStyle(document.documentElement)
  const accent: string = style.getPropertyValue('--app-accent').trim() || '#888888'
  const accentLight = accent.replace(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i, (_m: string, r: string, g: string, b: string) => {
    const lighten = (hex: string) => Math.min(255, parseInt(hex, 16) + 80).toString(16).padStart(2, '0')
    return `#${lighten(r)}${lighten(g)}${lighten(b)}`
  })

  const chars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'
  const fontSize = 14
  let columns = 0
  let drops: number[] = []
  let lastTime = 0
  const interval = 80 // ms between frames — slower, more cinematic

  function resize() {
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    columns = Math.floor(canvas.width / fontSize)
    drops = Array.from({ length: columns }, () => Math.random() * -50)
  }

  resize()
  const onResize = () => resize()
  window.addEventListener('resize', onResize)
  removeResize = () => window.removeEventListener('resize', onResize)

  function draw(time: number) {
    animId = requestAnimationFrame(draw)

    if (time - lastTime < interval) return
    lastTime = time

    // Fade trail
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${fontSize}px monospace`

    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)]
      const x = i * fontSize
      const y = drops[i] * fontSize

      if (y > 0 && y < canvas.height) {
        // Head (bright white-green)
        ctx.fillStyle = accentLight
        ctx.globalAlpha = 0.9
        ctx.fillText(char, x, y)

        // Body (green, fading)
        ctx.fillStyle = accent
        ctx.globalAlpha = 0.3
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y - fontSize)
        ctx.globalAlpha = 0.12
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y - fontSize * 2)
        ctx.globalAlpha = 0.04
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y - fontSize * 3)
      }

      ctx.globalAlpha = 1
      drops[i] += 0.3 + Math.random() * 0.3

      if (drops[i] * fontSize > canvas.height && Math.random() > 0.99) {
        drops[i] = 0
      }
    }
  }

  animId = requestAnimationFrame(draw)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  removeResize?.()
})
</script>

<template>
  <canvas ref="canvasRef" class="absolute inset-0 z-0 h-full w-full pointer-events-none" style="opacity: 0.08" />
</template>
