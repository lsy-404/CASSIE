<script setup lang="ts">
import { nextTick, ref } from "vue";
import { FluentButton, FluentCheckbox, FluentNotice, FluentProgressBar } from "@platform-kit/fluent/vue";
import { t } from "../i18n";
import { PANEL_TABS, useStudio, type PanelTab } from "../studio";
import AnnouncementPlayer from "./AnnouncementPlayer.vue";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const tabList = ref<HTMLElement | null>(null);

const LABELS: Record<PanelTab, string> = { player: "panelPlayer", problems: "panelProblems", analysis: "analysis", export: "output" };

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
      >{{ t(LABELS[tab]) }}<span v-if="tab === 'problems' && studio.allWarnings.length" class="badge">{{ studio.allWarnings.length }}</span></button>
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
        <div class="live-controls"><FluentCheckbox v-model="studio.liveRender" :aria-label="t('liveRender')">{{ t('liveRender') }}</FluentCheckbox><small>{{ t('liveHelp') }}</small></div>
      </div>
      <div v-show="studio.panelTab === 'problems'" id="panel-problems" class="pane" role="tabpanel" aria-labelledby="panel-tab-problems">
        <p v-if="!studio.allWarnings.length" class="empty">{{ t('noProblems') }}</p>
        <ul v-else class="problems">
          <li v-for="warning in studio.allWarnings" :key="warning" class="warning-item"><AppIcon name="warning" :size="14" /><span>{{ warning }}</span></li>
        </ul>
      </div>
      <div v-show="studio.panelTab === 'analysis'" id="panel-analysis" class="pane analysis-details" role="tabpanel" aria-labelledby="panel-tab-analysis">
        <p v-if="!studio.analysis.words.length && !studio.analysis.ipa.length" class="empty">{{ t('analysisEmpty') }}</p>
        <template v-else>
          <p>{{ t('detectedPieces', { count: studio.analysis.words.length }) }}</p>
          <p v-if="studio.analysis.ipa.length" class="ipa">{{ t('phonemes') }} {{ studio.analysis.ipa.join(' · ') }}</p>
        </template>
      </div>
      <div v-show="studio.panelTab === 'export'" id="panel-export" class="pane" role="tabpanel" aria-labelledby="panel-tab-export">
        <p class="empty">{{ t('localAudio') }}</p>
        <div v-if="studio.encodingOpus" class="render-progress"><FluentProgressBar :value="studio.progress" :max="100" :label="t('encodingProgress')" /><span>{{ t('encoding') }} · {{ Math.round(studio.progress) }}%</span></div>
        <FluentNotice v-if="studio.opusMessage" :tone="studio.opusUrl ? 'success' : /cancel|取消/i.test(studio.opusMessage) ? 'info' : 'danger'">{{ studio.statusText(studio.opusMessage) }}</FluentNotice>
        <div class="output-actions">
          <FluentButton v-if="studio.encodingOpus" tone="danger" @click="studio.cancelRender">{{ t('cancel') }}</FluentButton>
          <template v-if="studio.rendered">
            <a v-if="studio.downloadUrl" class="download-link" :href="studio.downloadUrl" download="cassie-announcement.wav"><AppIcon name="download" />{{ t('wav') }}</a>
            <FluentButton v-if="!studio.opusUrl" tone="secondary" :busy="studio.encodingOpus" :disabled="studio.encodingOpus" @click="studio.exportOpus">{{ t('exportOpus') }}</FluentButton>
            <a v-else class="download-link" :href="studio.opusUrl" download="cassie-announcement.opus"><AppIcon name="download" />{{ t('downloadOpus') }}</a>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bottom-panel { flex: none; display: flex; flex-direction: column; height: clamp(190px, 32vh, 300px); background: var(--ide-panel); border-top: 1px solid var(--ide-border-strong); }
.bottom-panel.closed { height: auto; }
.panel-tabs { flex: none; display: flex; align-items: stretch; height: 32px; padding: 0 8px; overflow-x: auto; scrollbar-width: none; }
.panel-tabs button { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: 0; border-bottom: 1px solid transparent; background: transparent; color: #a0a0a0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.panel-tabs button:hover { color: #fff; }
.panel-tabs button[aria-selected="true"] { color: #fff; border-bottom-color: #fff; }
.panel-tabs button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.panel-tabs .close { margin-left: auto; padding: 0 8px; }
.badge { min-width: 16px; padding: 0 4px; border-radius: 8px; background: #fff; color: #1e1e1e; font-size: 10px; line-height: 16px; text-align: center; letter-spacing: 0; }
.panel-content { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 12px; }
.pane { display: grid; gap: 10px; align-content: start; }
.empty { margin: 4px 0 0; color: var(--fluent-muted); font-size: 12px; }
.pane p { margin: 0; font-size: 12px; }
.ipa { color: var(--fluent-muted); font-family: var(--ide-mono); overflow-wrap: anywhere; }
.problems { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.warning-item { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--fluent-warning); }
.warning-item span { color: #d4d4d4; overflow-wrap: anywhere; }
.live-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.live-controls small { color: var(--fluent-muted); }
.render-progress { display: grid; gap: 6px; color: var(--fluent-muted); font-size: 11px; }
.output-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.download-link { min-height: 32px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; border: 1px solid var(--ide-border-strong); border-radius: 3px; background: var(--fluent-control); color: #fff; font-size: 12px; text-decoration: none; }
.download-link:hover { background: var(--fluent-control-hover); }
.download-link:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.announcement-player { margin-top: 0; }
@media (max-width: 819px) { .bottom-panel { height: clamp(180px, 38vh, 320px); } .bottom-panel.closed { height: auto; } }
</style>
