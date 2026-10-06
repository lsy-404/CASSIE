<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FluentButton, FluentNotice } from "@platform-kit/fluent/vue";
import { t } from "../i18n";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const LINE_HEIGHT = 20;
const scroll = ref({ top: 0, left: 0, barWidth: 0, barHeight: 0 });
const surface = ref<HTMLElement | null>(null);
const mirror = ref<HTMLElement | null>(null);
const rowHeights = ref<number[]>([]);

const lines = computed(() => studio.text.split("\n"));
const gutterDigits = computed(() => String(lines.value.length).length);

const parts = computed(() => {
  const text = studio.text;
  const timeline = studio.playbackResult?.timeline ?? [];
  const tokens = studio.analysis.tokens;
  const active = studio.activeTimelineItem;
  const boundaries = new Set([0, text.length]);
  for (const token of tokens) { boundaries.add(token.sourceStart); boundaries.add(token.sourceEnd); }
  for (const item of timeline) { boundaries.add(item.sourceStart); boundaries.add(item.sourceEnd); }
  const ordered = [...boundaries].filter((value) => value >= 0 && value <= text.length).sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1];
    const token = tokens.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const timing = timeline.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const kind = token?.kind ?? (timing?.kind === "gap" ? "gap" : "neutral");
    const labelKey = token?.blocked ? "blockedWord" : kind === "recorded" ? "recorded" : kind === "synthesized" ? "synthesized" : kind === "marker" ? "recognizedCommand" : kind === "gap" ? "gapLabel" : kind === "error" ? "cannotSynthesize" : "ordinaryText";
    const fix = token?.fix;
    const hints = [t(labelKey), token?.spellingMissing && !token.blocked ? t("dictionaryMissing") : "", fix ? (fix.replacement ? t("fixSuggestion", { text: fix.replacement }) : t("fixRemove")) : ""];
    return {
      key: `${start}-${end}`,
      text: text.slice(start, end),
      kind,
      blocked: Boolean(token?.blocked),
      fixable: Boolean(token?.spellingMissing || fix),
      spellingMissing: Boolean(token?.spellingMissing),
      active: Boolean(active && start >= active.sourceStart && start < active.sourceEnd),
      label: hints.filter(Boolean).join(" · "),
    };
  });
});

function reloadApp() { window.location.reload(); }
function setEditor(element: unknown) { studio.editorEl = element as HTMLTextAreaElement | null; }
function updateScroll() {
  const field = studio.editorEl;
  if (!field) return;
  const style = getComputedStyle(field);
  scroll.value = {
    top: field.scrollTop,
    left: field.scrollLeft,
    barWidth: Math.max(0, field.offsetWidth - field.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)),
    barHeight: Math.max(0, field.offsetHeight - field.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)),
  };
}
function measureRows() {
  const heights = Array.from(mirror.value?.children ?? [], (row) => (row as HTMLElement).offsetHeight || LINE_HEIGHT);
  if (heights.length === rowHeights.value.length && heights.every((height, index) => height === rowHeights.value[index])) return;
  rowHeights.value = heights;
}
function refresh() { updateScroll(); void nextTick(measureRows); }
function onInput() {
  requestAnimationFrame(refresh);
  studio.syncCursor();
}

const observer = new ResizeObserver(refresh);
watch(lines, () => void nextTick(measureRows));
onMounted(() => { if (surface.value) observer.observe(surface.value); });
onBeforeUnmount(() => observer.disconnect());
</script>

<template>
  <section class="editor-pane" :aria-label="t('editorRegion')">
    <div class="editor-tabs" role="tablist" :aria-label="t('editorTabsAria')">
      <div id="editor-tab-main" class="editor-tab" role="tab" aria-selected="true" aria-controls="editor-panel-main" tabindex="-1"><AppIcon name="file" :size="14" /><span>announcement.cassie</span></div>
    </div>
    <FluentNotice v-if="studio.urlError" tone="danger" data-testid="url-state-error">{{ t('urlStateInvalid') }}</FluentNotice>
    <FluentNotice v-if="studio.loading">{{ t('loadingBank') }}</FluentNotice>
    <FluentNotice v-else-if="studio.loadError" tone="danger">{{ studio.loadError }} <FluentButton tone="secondary" @click="reloadApp">{{ t('retry') }}</FluentButton></FluentNotice>
    <div id="editor-panel-main" class="editor-body annotated-editor" role="tabpanel" aria-labelledby="editor-tab-main" :style="{ '--gutter-digits': gutterDigits }">
      <div class="gutter" aria-hidden="true">
        <div class="gutter-lines" :style="{ transform: `translateY(${-scroll.top}px)` }"><div v-for="(_, index) in lines" :key="index" class="gutter-line" :style="{ height: `${rowHeights[index] ?? LINE_HEIGHT}px` }">{{ index + 1 }}</div></div>
      </div>
      <div ref="surface" class="surface" :style="{ '--bar-width': `${scroll.barWidth}px`, '--bar-height': `${scroll.barHeight}px` }">
        <div ref="mirror" class="mirror" aria-hidden="true"><div v-for="(line, index) in lines" :key="index">{{ line || " " }}</div></div>
        <textarea
          :ref="setEditor"
          v-model="studio.text"
          wrap="soft"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          :aria-label="t('editorAria')"
          :disabled="!studio.bank || studio.encodingOpus"
          :placeholder="t('editorPlaceholder')"
          @scroll="updateScroll"
          @input="onInput"
          @keyup="studio.syncCursor"
          @click="studio.syncCursor"
          @select="studio.syncCursor"
          @focus="studio.syncCursor"
        />
        <div class="highlight-clip" :style="{ '--scroll-top': `${scroll.top}px`, '--scroll-left': `${scroll.left}px` }" aria-hidden="true">
          <pre class="highlight-layer"><span v-for="part in parts" :key="part.key" :class="[`token-${part.kind}`, { active: part.active, blocked: part.blocked, fixable: part.fixable, 'spell-missing': part.spellingMissing }]" :title="part.label">{{ part.text }}</span></pre>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor-pane { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--ide-editor); }
.editor-tabs { flex: none; display: flex; height: 34px; background: var(--ide-sidebar); border-bottom: 1px solid var(--ide-border); }
.editor-tab { display: flex; align-items: center; gap: 8px; padding: 0 16px; background: var(--ide-editor); border-top: 1px solid #fff; border-right: 1px solid var(--ide-border); color: #fff; font-size: 13px; }
.editor-tab:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.editor-pane > :deep(.fluent-notice) { flex: none; margin: 8px 12px 0; }
.editor-body { --line-height: 20px; flex: 1; min-height: 0; display: flex; font: 13px/var(--line-height) var(--ide-mono); }
.gutter { flex: none; overflow: hidden; width: calc(var(--gutter-digits) * 1ch + 28px); padding-top: 8px; background: var(--ide-editor); color: var(--ide-line-number); text-align: right; user-select: none; }
.gutter-lines { padding-right: 12px; }
.surface { position: relative; flex: 1; min-width: 0; overflow: hidden; }
textarea { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; padding: 8px 12px; border: 0; border-radius: 0; resize: none; overflow: auto; background: transparent; color: transparent; caret-color: #fff; font: inherit; white-space: pre-wrap; overflow-wrap: break-word; tab-size: 2; outline: none; }
textarea:disabled { opacity: 1; background: transparent; cursor: progress; }
textarea::placeholder { color: var(--ide-line-number); }
textarea::selection { color: transparent; background: var(--ide-selection); }
.surface:focus-within { box-shadow: inset 0 0 0 1px var(--ide-border-strong); }
.highlight-clip { position: absolute; inset: 0 var(--bar-width, 0px) var(--bar-height, 0px) 0; z-index: 2; overflow: hidden; pointer-events: none; }
.mirror { position: absolute; top: 0; left: 0; right: var(--bar-width, 0px); padding: 8px 12px 0; visibility: hidden; pointer-events: none; white-space: pre-wrap; overflow-wrap: break-word; tab-size: 2; }
.highlight-layer { position: relative; min-height: 100%; width: 100%; margin: 0; padding: 8px 12px; color: var(--fluent-text); font: inherit; white-space: pre-wrap; overflow-wrap: break-word; tab-size: 2; transform: translate(calc(-1 * var(--scroll-left, 0px)), calc(-1 * var(--scroll-top, 0px))); }
.highlight-layer span { text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
.highlight-layer span.token-neutral, .highlight-layer span.token-gap { text-decoration: none; }
.highlight-layer span.active { color: var(--fluent-accent-text); background: var(--fluent-accent); border-radius: 2px; text-decoration: none; }
</style>
