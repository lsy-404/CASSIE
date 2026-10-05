<script setup lang="ts">
import { computed } from "vue";
import { locale, t } from "../i18n";
import { useStudio } from "../studio";

const studio = useStudio();

const state = computed(() => {
  if (studio.loadError) return { key: "statusError", tone: "error" };
  if (studio.loading) return { key: "statusLoading", tone: "busy" };
  if (studio.encodingOpus) return { key: "statusEncoding", tone: "busy" };
  if (studio.rendering) return { key: "statusRendering", tone: "busy" };
  return { key: "ready", tone: "ok" };
});
const duration = computed(() => studio.playbackDuration > 0 ? `${studio.playbackDuration.toFixed(2)}s` : "—");
</script>

<template>
  <footer class="statusbar">
    <span class="item state" :data-tone="state.tone"><i aria-hidden="true" />{{ t(state.key) }}</span>
    <span v-if="studio.busy" class="item progress" role="status">{{ Math.round(studio.progress) }}%<span class="bar" aria-hidden="true"><span :style="{ width: `${Math.max(0, Math.min(100, studio.progress))}%` }" /></span></span>
    <span class="spacer" />
    <span class="item">{{ t('cursorPosition', { line: studio.cursor.line, column: studio.cursor.column }) }}</span>
    <span class="item">{{ studio.text.length }} {{ t('characters') }}</span>
    <span class="item">{{ t('renderedDuration') }} {{ duration }}</span>
    <span class="item">{{ locale === 'zh' ? '中文' : 'English' }}</span>
  </footer>
</template>

<style scoped>
.statusbar { flex: none; height: var(--ide-statusbar-height); display: flex; align-items: center; gap: 2px; padding: 0 8px; background: var(--ide-statusbar); border-top: 1px solid var(--ide-border-strong); color: #d4d4d4; font-size: 12px; white-space: nowrap; overflow: hidden; }
.item { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; height: 100%; }
.spacer { flex: 1; }
.state i { width: 8px; height: 8px; border-radius: 50%; background: var(--fluent-success); }
.state[data-tone="busy"] i { background: var(--fluent-warning); }
.state[data-tone="error"] i { background: var(--fluent-danger); }
.bar { width: 80px; height: 4px; background: rgba(255, 255, 255, 0.2); }
.bar > span { display: block; height: 100%; background: #fff; }
@media (max-width: 600px) { .item:nth-last-child(-n + 2) { display: none; } }
</style>
