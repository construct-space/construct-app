<script setup lang="ts">
/**
 * NowPlaying — persistent mini-player in the title bar.
 *
 * Bound to the host's useMediaSession store. Shows whatever a space is
 * currently playing (cover + title + subtitle) with transport controls,
 * and survives space navigation because the store is host-owned. Clicking
 * the cover/title returns to the owning space.
 *
 * Renders nothing when nothing is playing.
 */
import { computed } from 'vue'
import { SkipBack, SkipForward, Play, Pause, Square, Music } from 'lucide-vue-next'
import { useMediaSession } from '@/composables/useMediaSession'
import { navigateToSpace } from '@/lib/spaceNavigation'

const media = useMediaSession()
const track = computed(() => media.state.track)

function openSpace() {
  const t = track.value
  if (!t) return
  void navigateToSpace({ spaceId: t.spaceId, page: t.page })
}
</script>

<template>
  <div v-if="track" class="now-playing" @contextmenu.stop>
    <!-- Cover + title — click returns to the owning space. -->
    <button class="now-playing__meta" :title="`${track.title}${track.subtitle ? ' · ' + track.subtitle : ''}`" @click="openSpace">
      <span class="now-playing__art">
        <img v-if="track.artwork" :src="track.artwork" alt="" />
        <Music v-else class="size-3.5 opacity-60" />
      </span>
      <span class="now-playing__text">
        <span class="now-playing__title">{{ track.title }}</span>
        <span v-if="track.subtitle" class="now-playing__subtitle">{{ track.subtitle }}</span>
      </span>
    </button>

    <!-- Transport. Skip buttons appear only when the playing space registered
         them (podcasts: skip 15s/30s; radio live streams: none). -->
    <div class="now-playing__controls">
      <button v-if="media.capabilities.skipBack" class="now-playing__btn" title="Back 15s" @click="media.skipBack()">
        <SkipBack class="size-3.5" />
      </button>
      <button class="now-playing__btn now-playing__btn--primary" :title="media.state.isPlaying ? 'Pause' : 'Play'" @click="media.toggle()">
        <Pause v-if="media.state.isPlaying" class="size-3.5" />
        <Play v-else class="size-3.5" />
      </button>
      <button v-if="media.capabilities.skipForward" class="now-playing__btn" title="Forward 30s" @click="media.skipForward()">
        <SkipForward class="size-3.5" />
      </button>
      <button class="now-playing__btn" title="Stop" @click="media.stop()">
        <Square class="size-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.now-playing {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 420px;
  height: 26px;
  padding: 0 0.35rem 0 0.35rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--app-input-bg) 70%, transparent);
  border: 1px solid var(--app-border);
}

.now-playing__meta {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  max-width: 230px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--app-foreground);
}

.now-playing__art {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 0.25rem;
  overflow: hidden;
  background: var(--app-input-bg);
  flex-shrink: 0;
}
.now-playing__art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-playing__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.05;
  text-align: left;
}
.now-playing__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--app-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.now-playing__subtitle {
  font-size: 10px;
  color: var(--app-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-playing__controls {
  display: inline-flex;
  align-items: center;
  gap: 0.05rem;
}

.now-playing__btn {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border-radius: 0.3rem;
  border: none;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.now-playing__btn:hover {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}
.now-playing__btn--primary {
  color: var(--app-accent);
}
.now-playing__btn--primary:hover {
  color: var(--app-accent);
}
</style>
