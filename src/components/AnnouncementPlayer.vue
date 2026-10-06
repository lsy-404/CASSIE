<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FluentButton, FluentSlider } from "@platform-kit/fluent/vue";
import type { TimelineEntry } from "../audio/types";

const props = defineProps<{
  src?: string;
  availableDuration: number;
  timeline: TimelineEntry[];
  rendering: boolean;
  progress: number;
  hasText: boolean;
  liveRender: boolean;
  complete: boolean;
}>();

const emit = defineEmits<{
  time: [seconds: number];
  render: [];
  cancel: [];
}>();

const { t } = useI18n();
const audio = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const currentTime = ref(0);
const mediaDuration = ref(0);
let restoreAfterSourceChange: { time: number; wasPlaying: boolean } | null = null;
let animationFrame = 0;

const duration = computed(() => {
  const available = Number.isFinite(props.availableDuration) ? Math.max(0, props.availableDuration) : 0;
  return available > 0 ? available : Number.isFinite(mediaDuration.value) ? Math.max(0, mediaDuration.value) : 0;
});
const segments = computed(() => props.timeline
  .filter((item) => item.endSeconds > item.startSeconds && duration.value > 0)
  .map((item) => ({
    key: `${item.startSeconds}-${item.endSeconds}-${item.sourceStart}`,
    kind: item.kind,
    left: `${Math.max(0, item.startSeconds / duration.value) * 100}%`,
    width: `${Math.max(0, (item.endSeconds - item.startSeconds) / duration.value) * 100}%`,
  })));

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

function updateTime(): void {
  const element = audio.value;
  if (!element) return;
  currentTime.value = element.currentTime;
  emit("time", currentTime.value);
}

function syncFrame(): void {
  if (!playing.value) return;
  updateTime();
  animationFrame = requestAnimationFrame(syncFrame);
}

function onPlay(): void {
  playing.value = true;
  if (restoreAfterSourceChange) restoreAfterSourceChange.wasPlaying = true;
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(syncFrame);
}

function onPause(): void {
  playing.value = false;
  cancelAnimationFrame(animationFrame);
  updateTime();
}

function onMetadata(): void {
  const element = audio.value;
  if (!element) return;
  mediaDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
  const restore = restoreAfterSourceChange;
  restoreAfterSourceChange = null;
  if (!restore) return;
  element.currentTime = Math.min(restore.time, duration.value || restore.time);
  updateTime();
  if (restore.wasPlaying) void element.play().catch(() => undefined);
}

function onDurationChange(): void {
  const element = audio.value;
  if (element) mediaDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
}

async function togglePlayback(): Promise<void> {
  const element = audio.value;
  if (!props.src || !element) {
    if (props.hasText && !props.rendering) emit("render");
    return;
  }
  if (element.paused) {
    try { await element.play(); }
    catch { playing.value = false; }
  } else element.pause();
}

function seek(value: number | string): void {
  const element = audio.value;
  const seconds = Number(value);
  if (!element || !Number.isFinite(seconds)) return;
  element.currentTime = Math.min(Math.max(0, seconds), duration.value || seconds);
  updateTime();
}

function stopPlayback(): void {
  audio.value?.pause();
  playing.value = false;
  cancelAnimationFrame(animationFrame);
  if (restoreAfterSourceChange) restoreAfterSourceChange.wasPlaying = false;
}

defineExpose({ stopPlayback });

watch(() => props.src, async () => {
  const element = audio.value;
  if (!element) return;
  restoreAfterSourceChange ??= { time: element.currentTime, wasPlaying: !element.paused };
  await nextTick();
  if (!props.src) {
    element.pause();
    currentTime.value = 0;
    mediaDuration.value = 0;
    restoreAfterSourceChange = null;
    emit("time", 0);
  }
}, { flush: "pre" });

onBeforeUnmount(stopPlayback);
</script>

<template>
  <section class="announcement-player" :data-rendering="rendering">
    <audio
      ref="audio"
      class="audio-player"
      :data-complete="complete"
      :src="src || undefined"
      :aria-label="t('player.audioPlayer')"
      preload="metadata"
      @loadedmetadata="onMetadata"
      @durationchange="onDurationChange"
      @timeupdate="updateTime"
      @seeking="updateTime"
      @play="onPlay"
      @pause="onPause"
      @ended="onPause"
    />

    <div class="player-controls">
      <FluentButton
        v-if="src || !liveRender"
        :tone="src ? 'primary' : 'secondary'"
        :disabled="src ? false : !hasText || rendering"
        :busy="!src && rendering"
        :aria-label="src ? t(playing ? 'player.pause' : 'player.play') : t('player.generate')"
        @click="togglePlayback"
      >
        {{ src ? t(playing ? 'player.pause' : 'player.play') : t('player.generate') }}
      </FluentButton>
      <FluentButton v-if="rendering" tone="danger" :aria-label="t('player.cancel')" @click="emit('cancel')">{{ t('player.cancel') }}</FluentButton>
      <span v-if="rendering" class="rendering-label" role="status">{{ t('player.rendering') }} · {{ Math.round(progress) }}%</span>
      <span class="player-time" aria-live="off">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
    </div>

    <div class="timeline-track">
      <div class="timeline-overview" :aria-label="t('player.timeline')" role="img">
        <span v-for="segment in segments" :key="segment.key" :class="['timeline-segment', `timeline-${segment.kind}`]" :style="{ left: segment.left, width: segment.width }" />
        <span v-if="rendering" class="timeline-progress" :style="{ width: `${Math.max(0, Math.min(100, progress))}%` }" />
        <span class="timeline-playhead" :style="{ left: `${duration ? currentTime / duration * 100 : 0}%` }" />
      </div>
      <FluentSlider
        class="diamond-slider"
        :model-value="currentTime"
        :min="0"
        :max="duration"
        :step="0.01"
        :disabled="!src || duration <= 0"
        :aria-label="t('player.seek')"
        @update:model-value="seek"
      />
    </div>
  </section>
</template>

<style scoped>
.announcement-player { display: grid; gap: 5px; width: 100%; margin-top: 15px; }
.audio-player { display: none; }
.player-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-height: 34px; }
.player-time { margin-left: auto; min-width: 86px; text-align: right; font: 12px ui-monospace, monospace; font-variant-numeric: tabular-nums; color: var(--fluent-muted); }
.rendering-label { color: var(--fluent-accent); font: 11px ui-monospace, monospace; }
.timeline-track { position: relative; min-height: 20px; }
.timeline-overview { position: absolute; inset: 0 8px; z-index: 1; height: 20px; pointer-events: none; }
.timeline-segment { position: absolute; top: 7px; height: 6px; min-width: 1px; background: var(--fluent-muted); opacity: .65; }
.timeline-gap { background: var(--fluent-warning); opacity: .55; }
.timeline-cue { background: var(--fluent-accent); }
.timeline-playhead { position: absolute; z-index: 2; top: 2px; bottom: 2px; width: 2px; background: var(--fluent-accent); }
.timeline-progress { position: absolute; z-index: 0; top: 7px; left: 0; height: 6px; background: var(--fluent-accent); opacity: .3; }
.timeline-track :deep(.fluent-slider) { position: relative; z-index: 0; }
</style>
