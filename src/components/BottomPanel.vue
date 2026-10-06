<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { FluentNotice } from "@platform-kit/fluent/vue";
import { t } from "../i18n";
import { PANEL_TABS, useStudio, type Notice, type PanelTab } from "../studio";
import AnnouncementPlayer from "./AnnouncementPlayer.vue";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const tabList = ref<HTMLElement | null>(null);

const LABELS: Record<PanelTab, string> = { player: "panelPlayer", analysis: "analysis" };
const SEVERITIES = ["error", "warning", "info"] as const;
const hidden = ref(new Set<Notice["severity"]>());

const counts = computed(() => Object.fromEntries(SEVERITIES.map((severity) => [severity, studio.notices.filter((notice) => notice.severity === severity).length])) as Record<Notice["severity"], number>);
const visible = computed(() => SEVERITIES.flatMap((severity) => hidden.value.has(severity) ? [] : studio.notices.filter((notice) => notice.severity === severity)));

function toggleSeverity(severity: Notice["severity"]) {
  const next = new Set(hidden.value);
  if (!next.delete(severity)) next.add(severity);
  hidden.value = next;
}
function setPlayer(element: unknown) { studio.player = element as { stopPlayback: () => void } | null; }
function onKeydown(event: KeyboardEvent) {
  const current = PANEL_TABS.indexOf(studio.panelTab);
  const next = event.key === "ArrowRight" ? (current + 1) % PANEL_TABS.length
    : event.key === "ArrowLeft" ? (current - 1 + PANEL_TABS.length) % PANEL_TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? PANEL_TABS.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  studio.panelTab = PANEL_TABS[next];
  void nextTick(() => tabList.value?.querySelector<HTMLElement>(`#panel-tab-${PANEL_TABS[next]}`)?.focus());
}
</script>

<template>
  <section class="bottom-panel" :class="{ closed: !studio.panelOpen }" :aria-label="t('panelAria')">
    <div class="panel-header">
    <div ref="tabList" class="panel-tabs" role="tablist" :aria-label="t('panelAria')" @keydown="onKeydown">
      <button
        v-for="tab in PANEL_TABS"
        :id="`panel-tab-${tab}`"
        :key="tab"
        type="button"
        role="tab"
        :aria-selected="studio.panelOpen && studio.panelTab === tab"
        :aria-controls="`panel-${tab}`"
        :tabindex="studio.panelTab === tab ? 0 : -1"
        @click="studio.showPanel(tab)"
      >{{ t(LABELS[tab]) }}<template v-if="tab === 'analysis'"><span v-for="severity in SEVERITIES" v-show="counts[severity]" :key="severity" :class="['badge', `sev-${severity}`]" :data-severity="severity">{{ counts[severity] }}</span></template></button>
    </div>
    <button class="close" type="button" :aria-label="t('panelClose')" :title="t('panelClose')" @click="studio.panelOpen = false"><AppIcon name="panel" /></button>
    </div>
    <div v-show="studio.panelOpen" class="panel-content">
      <div v-show="studio.panelTab === 'player'" id="panel-player" class="pane" role="tabpanel" aria-labelledby="panel-tab-player">
        <AnnouncementPlayer
          :ref="setPlayer"
          class="announcement-player"
          :src="studio.playbackUrl"
          :available-duration="studio.playbackDuration"
          :timeline="studio.playbackResult?.timeline ?? []"
          :rendering="studio.rendering"
          :progress="studio.progress"
          :has-text="studio.hasText"
          :live-render="studio.liveRender"
          :complete="Boolean(studio.rendered)"
          @time="(seconds: number) => { studio.audioTime = seconds; }"
          @render="studio.compose"
          @cancel="studio.cancelRender"
        />
        <FluentNotice v-if="studio.renderMessage" :tone="/cancel|取消/i.test(studio.renderMessage) ? 'info' : 'danger'">{{ studio.statusText(studio.renderMessage) }}</FluentNotice>
        <FluentNotice v-if="studio.opusMessage" :tone="studio.opusUrl ? 'success' : /cancel|取消/i.test(studio.opusMessage) ? 'info' : 'danger'">{{ studio.statusText(studio.opusMessage) }}</FluentNotice>
      </div>
      <div v-show="studio.panelTab === 'analysis'" id="panel-analysis" class="pane analysis-details" role="tabpanel" aria-labelledby="panel-tab-analysis">
        <p v-if="!studio.analysis.words.length && !studio.notices.length" class="empty">{{ t('analysisEmpty') }}</p>
        <template v-else>
          <div class="analysis-bar">
            <span>{{ t('detectedPieces', { count: studio.analysis.words.length }) }}</span>
            <div class="filters" role="group" :aria-label="t('severityFilter')">
              <button v-for="severity in SEVERITIES" :key="severity" type="button" :class="['filter', `sev-${severity}`]" :data-severity="severity" :aria-pressed="!hidden.has(severity)" @click="toggleSeverity(severity)"><AppIcon :name="severity" :size="14" />{{ t(`severity.${severity}`) }} {{ counts[severity] }}</button>
            </div>
          </div>
          <p v-if="!studio.notices.length" class="empty">{{ t('noProblems') }}</p>
          <ul v-else class="notices">
            <li v-for="(notice, index) in visible" :key="`${index}-${notice.text}`">
              <button type="button" :class="['notice-item', `sev-${notice.severity}`]" :data-severity="notice.severity" :disabled="notice.sourceStart === undefined" @click="notice.sourceStart !== undefined && studio.goToOffset(notice.sourceStart)">
                <AppIcon :name="notice.severity" :size="14" /><span>{{ notice.text }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bottom-panel { flex: none; display: flex; flex-direction: column; height: clamp(190px, 32vh, 300px); background: var(--ide-panel); border-top: 1px solid var(--ide-border-strong); }
.bottom-panel.closed { height: auto; }
.panel-header { flex: none; display: flex; align-items: stretch; height: 32px; padding: 0 8px; }
.panel-tabs { flex: 1; min-width: 0; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
.panel-header button { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: 0; border-bottom: 1px solid transparent; background: transparent; color: #a0a0a0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.panel-header button:hover { color: #fff; }
.panel-header button[aria-selected="true"] { color: #fff; border-bottom-color: #fff; }
.panel-header button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.panel-header .close { padding: 0 8px; }
.badge { min-width: 16px; padding: 0 5px; border-radius: 8px; background: #3c3c3c; font-size: 10px; line-height: 16px; text-align: center; letter-spacing: 0; }
.badge.sev-error, .sev-error .app-icon { color: var(--fluent-danger); }
.badge.sev-warning, .sev-warning .app-icon { color: var(--fluent-warning); }
.badge.sev-info, .sev-info .app-icon { color: var(--ide-line-number); }
.panel-content { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 12px; }
.pane { display: grid; gap: 10px; align-content: start; }
.empty { margin: 4px 0 0; color: var(--fluent-muted); font-size: 12px; }
.pane p { margin: 0; font-size: 12px; }
.analysis-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.filters { display: flex; flex-wrap: wrap; gap: 4px; }
.panel-header .filters button, .filter { height: 22px; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border: 1px solid var(--ide-border-strong); border-radius: 3px; background: transparent; color: #d4d4d4; font-size: 11px; text-transform: none; letter-spacing: 0; cursor: pointer; }
.filter[aria-pressed="true"] { background: var(--ide-active); }
.filter:not([aria-pressed="true"]) { opacity: 0.5; }
.filter:focus-visible, .notice-item:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.notices { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.notice-item { width: 100%; display: flex; gap: 8px; align-items: flex-start; padding: 3px 6px; border: 0; border-radius: 3px; background: transparent; color: #d4d4d4; font-size: 12px; text-align: left; cursor: pointer; }
.notice-item:hover:not(:disabled) { background: var(--ide-hover); }
.notice-item:disabled { cursor: default; }
.notice-item .app-icon { flex: none; margin-top: 2px; }
.notice-item span { overflow-wrap: anywhere; }
.announcement-player { margin-top: 0; }
@media (max-width: 819px) { .bottom-panel { height: clamp(180px, 38vh, 320px); } }
</style>
