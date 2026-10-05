<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { locale, setLocale, t } from "./i18n";
import {
  FluentButton, FluentCheckbox, FluentField, FluentNotice, FluentProgressBar,
  FluentSlider, FluentTheme,
} from "@platform-kit/fluent/vue";
import { analyzeAnnouncement, encodeWav, loadBank, renderAnnouncement, type AnalysisToken as EngineAnalysisToken, type TimelineEntry } from "./audio/engine";
import { checkEnglishSpelling } from "./spelling";
import AnnouncementPlayer from "./components/AnnouncementPlayer.vue";

type Bank = Awaited<ReturnType<typeof loadBank>>;
type AnalysisToken = EngineAnalysisToken & { spellingMissing?: boolean };
type RenderedAnnouncement = Omit<Awaited<ReturnType<typeof renderAnnouncement>>, "samples"> & { samples: Float32Array<ArrayBuffer>; timeline: TimelineEntry[] };
const bank = ref<Bank | null>(null);
const loading = ref(true);
const loadError = ref("");
const text = ref([
  "<start>",
  "CASSIE: Attention all personnel.",
  '<pitch value="1.2">Security</pitch> <rate value="1.1"><volume value="0.7">alert</volume></rate>.',
  'me<pitch value="1.1">tri</pitch>cs need review.',
  "ROC AUC I a A",
  '<stutter repeats="1">Attention</stutter><pause seconds="0.5"/>',
  "<br>",
  '<offset seconds="0.1">Lockdown</offset> <duration seconds="0.3">ends</duration> <spacing seconds="0.2">now</spacing>.',
  '<clip id="cassie"/>',
  "/ a e: / <end>",
  '<voice pitch="3" breathiness="0.3" formant="-2">Attention</voice>',
].join("\n"));
const pitch = ref(1);
const volume = ref(1);
const gap = ref(0.24);
const rate = ref(1);
const voicePitchSemitones = ref(0);
const breathiness = ref(0);
const formantSemitones = ref(0);
const liveRender = ref(true);
const primaryInsertions = [
  { label: "start", kind: "marker", value: "<start>" },
  { label: "end", kind: "marker", value: "<end>" },
  { label: "pause", kind: "marker", value: '<pause seconds="0.5"/>' },
  { label: "stutter", kind: "scope", open: '<stutter repeats="3">', close: "</stutter>" },
] as const;
const scopedInsertions = [
  { label: "pitch", open: '<pitch value="1.2">', close: "</pitch>" },
  { label: "volume", open: '<volume value="0.7">', close: "</volume>" },
  { label: "offset", open: '<offset seconds="0.1">', close: "</offset>" },
  { label: "duration", open: '<duration seconds="0.3">', close: "</duration>" },
  { label: "spacing", open: '<spacing seconds="0.2">', close: "</spacing>" },
  { label: "rate", open: '<rate value="1.2">', close: "</rate>" },
  { label: "voice", open: '<voice pitch="3" breathiness="0.3" formant="-2">', close: "</voice>" },
] as const;
const progress = ref(0);
const rendering = ref(false);
const renderMessage = ref("");
const rendered = ref<RenderedAnnouncement | null>(null);
const previewResult = ref<RenderedAnnouncement | null>(null);
const encodingOpus = ref(false);
const opusMessage = ref("");
const opusUrl = ref("");
const phoneKeys = ref<string[]>([]);
const phoneIndexError = ref("");
const analysis = ref<{ words: string[]; warnings: string[]; ipa: string[]; tokens: AnalysisToken[] }>({ words: [], warnings: [], ipa: [], tokens: [] });
const shellElement = ref<HTMLElement | null>(null);
const player = ref<InstanceType<typeof AnnouncementPlayer> | null>(null);
const audioTime = ref(0);
const editorScrollTop = ref(0);
const editorScrollbarWidth = ref(0);
const editorScrollLeft = ref(0);

let renderController: AbortController | null = null;
let analysisRevision = 0;
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
let analysisController: AbortController | null = null;
const downloadUrl = ref("");
const previewUrl = ref("");

function toggleLocale() { setLocale(locale.value === "zh" ? "en" : "zh"); }
const statusMessageKeys = new Set(["renderCancelled", "opusCancelled", "opusReady", "loadingOpus", "renderFailed", "opusFailed"]);
function statusText(message: string) { return statusMessageKeys.has(message) ? t(message) : message; }

const allWarnings = computed(() => [...new Set([...analysis.value.warnings, ...(rendered.value?.warnings ?? [])])]);
const playbackResult = computed(() => rendered.value ?? previewResult.value);
const playbackUrl = computed(() => rendered.value ? downloadUrl.value || undefined : previewUrl.value || undefined);
const playbackDuration = computed(() => playbackResult.value?.duration ?? 0);
const activeTimelineItem = computed(() => playbackResult.value?.timeline?.find((item) => audioTime.value >= item.startSeconds && audioTime.value < item.endSeconds) ?? null);
const editorParts = computed(() => {
  const timeline = playbackResult.value?.timeline ?? [];
  const boundaries = new Set([0, text.value.length]);
  for (const token of analysis.value.tokens) { boundaries.add(token.sourceStart); boundaries.add(token.sourceEnd); }
  for (const item of timeline) { boundaries.add(item.sourceStart); boundaries.add(item.sourceEnd); }
  const ordered = [...boundaries].filter((value) => value >= 0 && value <= text.value.length).sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1];
    const token = analysis.value.tokens.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const timing = timeline.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const kind = token?.kind ?? (timing?.kind === "gap" ? "gap" : "neutral");
    const labelKey = token?.spellingMissing ? "dictionaryMissing" : kind === "recorded" ? "recorded" : kind === "synthesized" ? "synthesized" : kind === "marker" ? "recognizedCommand" : kind === "gap" ? "gapLabel" : kind === "error" ? "renderError" : "ordinaryText";
    return { key: `${start}-${end}`, text: text.value.slice(start, end), kind, spellingMissing: Boolean(token?.spellingMissing), active: Boolean(activeTimelineItem.value && start >= activeTimelineItem.value.sourceStart && start < activeTimelineItem.value.sourceEnd), label: t(labelKey) };
  });
});

function replaceEditorRange(value: string, selection?: { start: number; end: number }) {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  const expectedContent = before + value + after;
  text.value = expectedContent;
  void nextTick(() => {
    if (text.value !== expectedContent || field?.value !== expectedContent) return;
    field?.focus();
    const selectionStart = start + (selection?.start ?? value.length);
    const selectionEnd = start + (selection?.end ?? value.length);
    field?.setSelectionRange(selectionStart, selectionEnd);
  });
}
function insertMarker(value: string) {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const selected = text.value.slice(start, end);
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  const expectedContent = before + value + selected + after;
  text.value = expectedContent;
  void nextTick(() => {
    if (text.value !== expectedContent || field?.value !== expectedContent) return;
    field?.focus();
    field?.setSelectionRange(start + value.length, start + value.length);
  });
}
function insertClip() { insertMarker('<clip id="a"/>'); }
function insertScope(open: string, close: string, placeholder = "word") {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const selected = text.value.slice(start, end);
  const body = selected || placeholder;
  const insertion = open + body + close;
  replaceEditorRange(insertion, { start: open.length, end: open.length + body.length });
}
function scheduleAnalysis() {
  const revision = ++analysisRevision;
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisController?.abort();
  analysisController = null;
  if (!bank.value) { analysis.value = { words: [], warnings: [], ipa: [], tokens: [] }; return; }
  analysisTimer = setTimeout(async () => {
    const currentBank = bank.value;
    if (!currentBank) return;
    const controller = new AbortController();
    analysisController = controller;
    try {
      const result = await analyzeAnnouncement(text.value, currentBank, true, controller.signal);
      let tokens: AnalysisToken[] = result.tokens;
      const spellingWords = [...new Set(tokens
        .filter((token) => (token.kind === "synthesized" || token.kind === "error") && token.spellingWord)
        .map((token) => token.spellingWord!))];
      if (spellingWords.length) {
        try {
          const missing = await checkEnglishSpelling(spellingWords, controller.signal);
          tokens = tokens.map((token) => token.spellingWord && missing.has(token.spellingWord.toLocaleLowerCase("en-US"))
            ? { ...token, spellingMissing: true }
            : token);
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
      }
      if (!controller.signal.aborted && revision === analysisRevision) analysis.value = { ...result, tokens };
    } catch (error) {
      if (!controller.signal.aborted && revision === analysisRevision) analysis.value = { words: [], warnings: [error instanceof Error ? error.message : "无法分析公告文本"], ipa: [], tokens: [] };
    } finally {
      if (analysisController === controller) analysisController = null;
    }
  }, 120);
}
function stopPlayback() {
  player.value?.stopPlayback();
}
function cancelRender() {
  const wasEncodingOpus = encodingOpus.value;
  renderController?.abort();
  renderController = null;
  rendering.value = false;
  encodingOpus.value = false;
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  opusMessage.value = wasEncodingOpus ? "opusCancelled" : "";
  renderMessage.value = wasEncodingOpus ? "" : "renderCancelled";
}
async function compose() {
  if (!bank.value || !text.value.trim() || rendering.value || encodingOpus.value) return;
  stopPlayback();
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  downloadUrl.value = "";
  previewUrl.value = "";
  previewResult.value = null;
  opusUrl.value = "";
  opusMessage.value = "";
  rendered.value = null;
  renderMessage.value = "";
  progress.value = 0;
  rendering.value = true;
  const controller = new AbortController();
  renderController = controller;
  try {
    const result = await renderAnnouncement(text.value, bank.value,
      { pitch: pitch.value, volume: volume.value, gap: gap.value, rate: rate.value, phonemes: true,
        voice: { pitchSemitones: voicePitchSemitones.value, breathiness: breathiness.value, formantSemitones: formantSemitones.value } },
      (value) => { progress.value = Math.max(0, Math.min(100, value * 100)); }, controller.signal,
      (snapshot) => {
        if (controller.signal.aborted) return;
        const oldUrl = previewUrl.value;
        previewResult.value = { ...snapshot, samples: snapshot.samples as Float32Array<ArrayBuffer> };
        previewUrl.value = URL.createObjectURL(encodeWav(snapshot.samples, snapshot.sampleRate));
        if (oldUrl) void nextTick(() => URL.revokeObjectURL(oldUrl));
      });
    if (controller.signal.aborted) return;
    const samples = result.samples as Float32Array<ArrayBuffer>;
    rendered.value = { ...result, samples };
    downloadUrl.value = URL.createObjectURL(encodeWav(samples, result.sampleRate));
    const oldPreviewUrl = previewUrl.value;
    previewUrl.value = "";
    previewResult.value = null;
    if (oldPreviewUrl) void nextTick(() => URL.revokeObjectURL(oldPreviewUrl));
    renderMessage.value = "";
    progress.value = 100;
  } catch (error) {
    renderMessage.value = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "renderCancelled" : error instanceof Error ? error.message : "renderFailed";
  } finally {
    if (renderController === controller) { renderController = null; rendering.value = false; }
  }
}
async function exportOpus() {
  if (!rendered.value || encodingOpus.value || rendering.value) return;
  encodingOpus.value = true;
  progress.value = 0;
  opusMessage.value = "loadingOpus";
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  const controller = new AbortController();
  renderController = controller;
  try {
    const { encodeOpus } = await import("./audio/export");
    const blob = await encodeOpus(rendered.value.samples, rendered.value.sampleRate,
      (value) => { progress.value = Math.max(0, Math.min(100, value * 100)); }, controller.signal);
    if (controller.signal.aborted) return;
    opusUrl.value = URL.createObjectURL(blob);
    opusMessage.value = "opusReady";
    progress.value = 100;
  } catch (error) {
    opusMessage.value = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "opusCancelled" : error instanceof Error ? error.message : "opusFailed";
  } finally {
    if (renderController === controller) { renderController = null; encodingOpus.value = false; }
  }
}
function onPlayerTime(seconds: number) { audioTime.value = seconds; }
function onEditorScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  const style = getComputedStyle(textarea);
  editorScrollTop.value = textarea.scrollTop;
  editorScrollLeft.value = textarea.scrollLeft;
  editorScrollbarWidth.value = Math.max(0, textarea.offsetWidth - textarea.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth));
}
function onEditorInput(event: Event) { requestAnimationFrame(() => onEditorScroll(event)); }
function reloadApp() { window.location.reload(); }
function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey &&
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable))) {
    event.preventDefault();
    shellElement.value?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }
}
watch([text, bank], scheduleAnalysis, { immediate: true });
let liveRenderTimer: ReturnType<typeof setTimeout> | undefined;
function invalidateRendered() {
  stopPlayback(); audioTime.value = 0; rendered.value = null; renderMessage.value = ""; opusMessage.value = "";
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  downloadUrl.value = "";
  previewUrl.value = "";
  previewResult.value = null;
}
watch([text, pitch, volume, gap, rate, voicePitchSemitones, breathiness, formantSemitones, bank], () => {
  invalidateRendered();
  if (renderController) cancelRender();
  if (!liveRender.value || !bank.value || !text.value.trim()) return;
  if (liveRenderTimer) clearTimeout(liveRenderTimer);
  liveRenderTimer = setTimeout(() => { if (!rendering.value && !encodingOpus.value) void compose(); }, 500);
});
watch(liveRender, (enabled) => {
  if (liveRenderTimer) clearTimeout(liveRenderTimer);
  if (!enabled && renderController) cancelRender();
  if (enabled) { invalidateRendered(); if (bank.value && text.value.trim()) liveRenderTimer = setTimeout(() => void compose(), 500); }
});
onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown);
  void fetch("/phonemes.json").then(async (response) => {
    if (!response.ok) throw new Error(t("phonemeIndexError"));
    const data = await response.json() as { phones?: Record<string, unknown> };
    phoneKeys.value = Object.keys(data.phones ?? {}).sort((left, right) => left.localeCompare(right));
  }).catch((error) => { phoneIndexError.value = error instanceof Error ? error.message : t("phonemeIndexError"); });
  try { bank.value = await loadBank(); }
  catch (error) { loadError.value = error instanceof Error ? error.message : t("bankLoadError"); }
  finally { loading.value = false; }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  if (analysisTimer) clearTimeout(analysisTimer);
  if (liveRenderTimer) clearTimeout(liveRenderTimer);
  analysisRevision += 1;
  analysisController?.abort();
  analysisController = null;
  renderController?.abort(); stopPlayback();
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
});
</script>

<template>
  <FluentTheme mode="system">
    <div ref="shellElement" class="studio-shell">
      <header class="topbar">
        <a class="brand" href="#main"><strong>CASSIE</strong><span>{{ t('appTitle') }}</span></a>
        <div class="topbar-actions"><FluentButton tone="subtle" :aria-label="t('lang')" @click="toggleLocale">{{ locale === 'zh' ? t('english') : t('chinese') }}</FluentButton><a href="https://github.com/lsy-404/CASSIE" target="_blank" rel="noreferrer">{{ t('source') }}</a></div>
      </header>
      <main id="main" class="workspace">
        <section class="page-heading"><div><p>{{ t('studio') }}</p><h1>{{ t('heading') }}</h1><p>{{ t('pageIntro') }}</p></div></section>
        <FluentNotice v-if="loading">{{ t('loadingBank') }}</FluentNotice>
        <FluentNotice v-else-if="loadError" tone="danger">{{ loadError }} <FluentButton tone="secondary" @click="reloadApp">{{ t('retry') }}</FluentButton></FluentNotice>
        <div class="studio-grid">
          <section class="main-column" :aria-label="t('editorRegion')">
            <section class="panel">
              <div class="panel-heading"><div><h2>{{ t('announcement') }}</h2><p>{{ t('intro') }}</p></div><span>{{ text.length }} {{ t('characters') }}</span></div>
              <div class="authoring-tools">
                <div class="tool-group"><strong>{{ t('insertVoiceTags') }}</strong>
                  <FluentButton v-for="command in primaryInsertions" :key="command.label" tone="secondary" :disabled="!bank || encodingOpus" @click="command.kind === 'scope' ? insertScope(command.open, command.close) : insertMarker(command.value)">{{ t(command.label) }}</FluentButton>
                </div>
                <p class="markup-inline-note">{{ t('inlineExample') }} <code>me&lt;pitch value="1.2"&gt;tri&lt;/pitch&gt;cs</code></p>
                <details class="advanced-tools"><summary>{{ t('advanced') }}</summary>
                  <div class="tool-group"><FluentButton v-for="command in scopedInsertions" :key="command.label" tone="subtle" :disabled="!bank || encodingOpus" @click="insertScope(command.open, command.close)">{{ t(command.label) }}</FluentButton><FluentButton tone="subtle" :disabled="!bank || encodingOpus" @click="insertClip">{{ t('clip') }}</FluentButton><FluentButton tone="subtle" :disabled="!bank || encodingOpus" @click="replaceEditorRange('/ a e: /')">{{ t('insertPhonemes') }}</FluentButton></div>
                  <div class="help-examples">
                    <p>{{ t('wholeWord') }} <code>&lt;pitch value="1.2"&gt;attention&lt;/pitch&gt;</code>{{ t('fullStop') }} {{ t('repeatHelp') }}</p>
                    <p>{{ t('cursorHelp') }} <code>{{ t('wordPlaceholder') }}</code>{{ t('fullStop') }}</p>
                    <p>{{ t('standaloneHelp') }} <code>&lt;start&gt;</code>/<code>&lt;start/&gt;</code> {{ t('andWord') }} <code>&lt;end&gt;</code>/<code>&lt;end/&gt;</code> {{ t('equivalent') }} <code>&lt;br&gt;</code>{{ t('brHelp') }}<code>&lt;br/&gt;</code>{{ t('brAlsoPauses') }}</p>
                    <p>{{ t('pauseHelp') }} <code>&lt;pause seconds="0.5"&gt;</code> {{ t('orWord') }} <code>&lt;pause seconds="0.5"/&gt;</code>{{ t('listSeparator') }} {{ t('clipHelp') }} <code>&lt;clip id="cassie"&gt;</code> {{ t('orWord') }} <code>&lt;clip id="cassie"/&gt;</code>{{ t('comma') }} {{ t('replaceClipId') }}</p>
                    <p>{{ t('phonemeHelp') }} <code>/ a e: /</code>{{ t('fullStop') }} {{ t('caseHelp') }}</p>
                    <p>{{ t('rateExample') }} <code>&lt;rate value="1.2"&gt;attention&lt;/rate&gt;</code>{{ t('fullStop') }} {{ t('rateHelp') }}</p>
                    <p>{{ t('voiceExample') }} <code>&lt;voice pitch="3" breathiness="0.3" formant="-2"&gt;attention&lt;/voice&gt;</code>{{ t('fullStop') }} {{ t('voiceTagHelp') }}</p>
                  </div>
                </details>
              </div>
              <div class="phrase-field annotated-editor"><FluentField v-model="text" :label="t('editorAria')" multiline wrap="soft" :disabled="!bank || encodingOpus" :placeholder="t('editorPlaceholder')" @scroll="onEditorScroll" @input="onEditorInput" /><div class="highlight-clip" :style="{ '--editor-scroll': `${editorScrollTop}px`, '--editor-scroll-left': `${editorScrollLeft}px`, '--editor-scrollbar-width': `${editorScrollbarWidth}px` }" aria-hidden="true"><pre class="highlight-layer"><span v-for="part in editorParts" :key="part.key" :class="[`token-${part.kind}`, { active: part.active, 'spell-missing': part.spellingMissing }]" :title="part.label">{{ part.text }}</span></pre></div></div>
              <div class="token-legend" :aria-label="t('legendAria')"><span class="token-recorded">{{ t('recorded') }}</span><span class="token-synthesized">{{ t('synthesized') }}</span><span class="spell-legend">{{ t('spellingHint') }}</span><span class="token-marker">{{ t('recognizedCommand') }}</span><span class="token-error">{{ t('approximateOrError') }}</span></div>
              <AnnouncementPlayer
                ref="player"
                class="announcement-player"
                :src="playbackUrl"
                :available-duration="playbackDuration"
                :rendering="rendering"
                :progress="progress"
                :has-text="Boolean(text.trim()) && Boolean(bank)"
                :live-render="liveRender"
                :complete="Boolean(rendered)"
                @time="onPlayerTime"
                @render="compose"
                @cancel="cancelRender"
              />
              <FluentNotice v-if="renderMessage" :tone="/cancel|取消/i.test(renderMessage) ? 'info' : 'danger'">{{ statusText(renderMessage) }}</FluentNotice>
              <FluentNotice v-if="allWarnings.length" tone="warning"><strong>{{ t('renderNotice') }}</strong><span v-for="warning in allWarnings.slice(0, 4)" :key="warning" class="warning-item">{{ warning }}</span></FluentNotice>
              <div class="live-controls"><FluentCheckbox v-model="liveRender" :aria-label="t('liveRender')">{{ t('liveRender') }}</FluentCheckbox><small>{{ t('liveHelp') }}</small></div>
              <details v-if="analysis.words.length || analysis.ipa.length || analysis.warnings.length" class="analysis-details"><summary>{{ t('analysis') }}</summary><p>{{ t('detectedPieces', { count: analysis.words.length }) }}<span v-if="analysis.ipa.length"> · {{ t('phonemes') }} {{ analysis.ipa.join(' · ') }}</span></p><FluentNotice v-if="analysis.warnings.length" tone="warning">{{ analysis.warnings[0] }}<span v-if="analysis.warnings.length > 1">（{{ analysis.warnings.length - 1 }} {{ t('otherNotices') }}）</span></FluentNotice></details>
            </section>
          </section>
          <aside class="side-column" :aria-label="t('settingsRegion')">
            <section class="panel">
              <div class="panel-heading"><div><h2>{{ t('settings') }}</h2><p>{{ t('globalMix') }}</p></div></div>
              <div class="settings">
                <label><span>{{ t('pitchLabel', { value: pitch.toFixed(2) }) }}</span><FluentSlider v-model="pitch" :min="0.65" :max="1.35" :step="0.01" :aria-label="t('pitch')" /></label>
                <label><span>{{ t('volumeLabel', { value: Math.round(volume * 100) }) }}</span><FluentSlider v-model="volume" :min="0.1" :max="1" :step="0.01" :aria-label="t('volume')" /></label>
                <label><span>{{ t('gapLabelSetting', { value: gap.toFixed(2) }) }}</span><FluentSlider v-model="gap" :min="0" :max="0.8" :step="0.01" :aria-label="t('wordGap')" /></label>
                <label><span>{{ t('rateLabel', { value: rate.toFixed(2) }) }}<small>{{ t('rateHelp') }}</small></span><FluentSlider v-model="rate" :min="0.5" :max="2" :step="0.05" :aria-label="t('rate')" /></label>
                <details class="voice-processing">
                  <summary>{{ t('voiceProcessing') }}</summary>
                  <p>{{ t('voiceHelp') }}</p>
                  <label><span>{{ t('voicePitchLabel', { value: voicePitchSemitones.toFixed(1) }) }}</span><FluentSlider v-model="voicePitchSemitones" :min="-12" :max="12" :step="0.5" :aria-label="t('voicePitch')" /></label>
                  <label><span>{{ t('breathinessLabel', { value: breathiness.toFixed(2) }) }}</span><FluentSlider v-model="breathiness" :min="0" :max="1" :step="0.05" :aria-label="t('breathiness')" /></label>
                  <label><span>{{ t('formantLabel', { value: formantSemitones.toFixed(1) }) }}</span><FluentSlider v-model="formantSemitones" :min="-6" :max="6" :step="0.5" :aria-label="t('formant')" /></label>
                </details>
                <div class="phoneme-setting"><span>{{ t('missingWords') }}<small>{{ t('missingHelp') }}</small></span><span class="setting-state">{{ t('enabled') }}</span></div>
                <details class="phone-inventory"><summary>{{ t('inventory', { count: phoneKeys.length }) }}</summary><span v-if="phoneIndexError">{{ phoneIndexError }}</span><div v-else class="phone-list"><FluentButton v-for="phone in phoneKeys" :key="phone" tone="subtle" :aria-label="t('insertPhone', { phone })" :title="t('phoneTitle', { phone })" @click="replaceEditorRange(`/ ${phone} /`)">{{ phone }}</FluentButton></div></details>
              </div>
            </section>
            <section class="panel output-panel">
              <div class="panel-heading"><div><h2>{{ t('output') }}</h2><p>{{ t('localAudio') }}</p></div></div>
              <div v-if="encodingOpus" class="render-progress"><FluentProgressBar :value="progress" :max="100" :label="t('encodingProgress')" /><span>{{ t('encoding') }} · {{ Math.round(progress) }}%</span></div>
              <FluentNotice v-if="opusMessage" :tone="opusUrl ? 'success' : /cancel|取消/i.test(opusMessage) ? 'info' : 'danger'">{{ statusText(opusMessage) }}</FluentNotice>
              <div class="output-actions">
                <FluentButton v-if="encodingOpus" tone="danger" @click="cancelRender">{{ t('cancel') }}</FluentButton>
                <template v-if="rendered">
                  <a v-if="downloadUrl" class="download-link" :href="downloadUrl" download="cassie-announcement.wav">{{ t('wav') }}</a>
                  <FluentButton v-if="!opusUrl" tone="secondary" :busy="encodingOpus" :disabled="encodingOpus" @click="exportOpus">{{ t('exportOpus') }}</FluentButton>
                  <a v-else class="download-link" :href="opusUrl" download="cassie-announcement.opus">{{ t('downloadOpus') }}</a>
                </template>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <footer class="footer">CASSIE <span>·</span> {{ t('studio') }} <span>·</span> <a href="https://github.com/lsy-404/CASSIE">{{ t('sourceFooter') }}</a> <span>·</span> <a href="/licenses.html">{{ t('licenses') }}</a></footer>
    </div>
  </FluentTheme>
</template>
