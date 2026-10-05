<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FluentButton, FluentProgressBar, FluentSlider } from "@platform-kit/fluent/vue";

const props = defineProps<{
  src?: string;
  availableDuration: number;
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

const duration = computed(() => {
  if (Number.isFinite(mediaDuration.value) && mediaDuration.value > 0) {
    return Number.isFinite(props.availableDuration) && props.availableDuration > 0
      ? Math.min(mediaDuration.value, props.availableDuration)
      : mediaDuration.value;
  }
  return Number.isFinite(props.availableDuration) ? Math.max(0, props.availableDuration) : 0;
});

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

function onMetadata(): void {
  const element = audio.value;
  if (!element) return;
  mediaDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
  const restore = restoreAfterSourceChange;
  restoreAfterSourceChange = null;
  if (!restore) return;
  const max = Number.isFinite(element.duration) ? element.duration : restore.time;
  element.currentTime = Math.min(restore.time, max);
  updateTime();
  if (restore.wasPlaying) {
    void element.play().catch(() => undefined);
  }
}

function onDurationChange(): void {
  const element = audio.value;
  if (!element) return;
  mediaDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
}

async function togglePlayback(): Promise<void> {
  const element = audio.value;
  if (!props.src || !element) {
    if (props.hasText && !props.rendering) emit("render");
    return;
  }
  if (element.paused) {
    try {
      await element.play();
    } catch {
      playing.value = false;
    }
  } else {
    element.pause();
  }
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
  if (restoreAfterSourceChange) restoreAfterSourceChange.wasPlaying = false;
}

defineExpose({ stopPlayback });

watch(() => props.src, async () => {
  const element = audio.value;
  if (!element) return;
  restoreAfterSourceChange ??= {
    time: element.currentTime,
    wasPlaying: !element.paused,
  };
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
  <section class="announcement-player">
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
      @play="playing = true; if (restoreAfterSourceChange) restoreAfterSourceChange.wasPlaying = true"
      @pause="playing = false"
      @ended="playing = false; updateTime()"
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
      <div class="player-seek">
        <FluentSlider
          :model-value="currentTime"
          :min="0"
          :max="duration"
          :step="0.05"
          :disabled="!src || duration <= 0"
          :aria-label="t('player.seek')"
          @update:model-value="seek"
        />
        <span class="player-time" aria-live="off">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
      </div>
    </div>

    <div v-if="rendering" class="player-progress">
      <FluentProgressBar :value="progress" :max="100" :label="t('player.rendering')" />
      <FluentButton tone="danger" @click="emit('cancel')">{{ t('player.cancel') }}</FluentButton>
    </div>
  </section>
</template>

<style scoped>
.announcement-player { display: grid; gap: 10px; width: 100%; }
.audio-player { display: none; }
.player-controls, .player-progress { display: flex; align-items: center; gap: 12px; }
.player-seek { display: flex; flex: 1; align-items: center; gap: 12px; min-width: 0; }
.player-seek :deep(input[type="range"]) { width: 100%; }
.player-time { min-width: 92px; text-align: right; font-variant-numeric: tabular-nums; }
.player-progress :deep(progress) { flex: 1; }
</style>
