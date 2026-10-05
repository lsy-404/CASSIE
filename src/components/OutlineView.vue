<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();

const entries = computed(() => {
  const source = studio.text;
  return studio.analysis.tokens
    .filter((token) => (token.kind === "marker" && !token.text.startsWith("</")) || token.kind === "error")
    .map((token) => ({
      key: `${token.sourceStart}-${token.sourceEnd}`,
      start: token.sourceStart,
      kind: token.kind,
      label: token.text.length > 48 ? `${token.text.slice(0, 47)}…` : token.text,
      line: source.slice(0, token.sourceStart).split("\n").length,
    }));
});
</script>

<template>
  <div class="outline">
    <p v-if="!entries.length" class="empty">{{ t('outlineEmpty') }}</p>
    <ul v-else>
      <li v-for="entry in entries" :key="entry.key">
        <button type="button" :class="`kind-${entry.kind}`" :title="entry.label" @click="studio.goToOffset(entry.start)">
          <AppIcon :name="entry.kind === 'error' ? 'warning' : 'tag'" :size="14" />
          <code>{{ entry.label }}</code>
          <span class="line">{{ t('lineShort', { line: entry.line }) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.outline ul { margin: 0; padding: 0; list-style: none; }
.empty { margin: 4px 4px 0; color: var(--fluent-muted); font-size: 12px; line-height: 1.5; }
button { width: 100%; min-height: 26px; display: flex; align-items: center; gap: 8px; padding: 2px 6px; border: 0; border-radius: 3px; background: transparent; color: #d4d4d4; text-align: left; cursor: pointer; }
button:hover { background: var(--ide-hover); }
button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px var(--ide-mono); }
.line { flex: none; color: var(--fluent-muted); font: 11px var(--ide-mono); }
.kind-error { color: var(--fluent-danger); }
</style>
