<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FluentButton, FluentField, FluentProgressBar, FluentSlider, FluentSwitch, FluentTheme } from "@platform-kit/fluent/vue";
import { analyzeText } from "./audio/parser";
import { encodeWav, loadBank, renderAnnouncement } from "./audio/engine";

type Bank = Awaited<ReturnType<typeof loadBank>>;
type Preset = "standard" | "urgent" | "containment";
type RenderedAnnouncement = Omit<Awaited<ReturnType<typeof renderAnnouncement>>, "samples"> & { samples: Float32Array<ArrayBuffer> };
const bank = ref<Bank | null>(null);
const loading = ref(true);
const loadError = ref("");
const text = ref("Attention all personnel. The facility is now under lockdown.");
const preset = ref<Preset>("standard");
const pitch = ref(1);
const volume = ref(1);
const gap = ref(0.24);
const background = ref(false);
const darkMode = ref(true);
const query = ref("");
const kindFilter = ref<"all" | "word" | "effect">("all");
const visibleLimit = ref(16);
const progress = ref(0);
const rendering = ref(false);
const renderMessage = ref("");
const rendered = ref<RenderedAnnouncement | null>(null);
const playing = ref(false);
const audioError = ref("");
const encodingOpus = ref(false);
const opusMessage = ref("");
const opusUrl = ref("");
const shellElement = ref<HTMLElement | null>(null);

let renderController: AbortController | null = null;
let audioContext: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let downloadUrl = "";

const analysis = computed(() => bank.value ? analyzeText(text.value, bank.value) : { words: [], warnings: [] });
const allWarnings = computed(() => [...analysis.value.warnings, ...(rendered.value?.warnings ?? [])]);
const themeMode = computed(() => darkMode.value ? "dark" : "light");
const matchingClips = computed(() => (bank.value?.clips ?? []).filter((clip) => {
  const kindMatches = kindFilter.value === "all" || clip.kind === kindFilter.value;
  const needle = query.value.trim().toLowerCase();
  return kindMatches && (!needle || (clip.id + " " + clip.file).toLowerCase().includes(needle));
}));
const visibleClips = computed(() => matchingClips.value.slice(0, visibleLimit.value));
const presets: Record<Preset, { label: string; pitch: number; volume: number; gap: number; background: boolean }> = {
  standard: { label: "Standard", pitch: 1, volume: 1, gap: 0.24, background: false },
  urgent: { label: "Urgent", pitch: 1.12, volume: 1, gap: 0.1, background: false },
  containment: { label: "Containment", pitch: 0.9, volume: 0.92, gap: 0.32, background: true },
};
const presetOptions = (Object.entries(presets) as [Preset, (typeof presets)[Preset]][])
  .map(([value, settings]) => ({ value, label: settings.label }));
const kindFilters: { value: "all" | "word" | "effect"; label: string }[] = [
  { value: "all", label: "All" }, { value: "word", label: "Words" }, { value: "effect", label: "Effects" },
];

function applyPreset(value: Preset) {
  preset.value = value;
  pitch.value = presets[value].pitch;
  volume.value = presets[value].volume;
  gap.value = presets[value].gap;
  background.value = presets[value].background;
}

function stopPlayback() {
  if (!activeSource) return;
  const source = activeSource;
  activeSource = null;
  source.onended = null;
  source.stop();
  playing.value = false;
}

function cancelRender() {
  renderController?.abort();
  renderController = null;
  rendering.value = false;
  encodingOpus.value = false;
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  opusMessage.value = "Encoding cancelled";
  renderMessage.value = "Rendering cancelled";
}

async function compose() {
  if (!bank.value || !text.value.trim() || rendering.value || encodingOpus.value) return;
  stopPlayback();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  downloadUrl = "";
  opusUrl.value = "";
  rendered.value = null;
  renderMessage.value = "Preparing audio engine…";
  progress.value = 0;
  rendering.value = true;
  const controller = new AbortController();
  renderController = controller;
  try {
    const result = await renderAnnouncement(
      text.value,
      bank.value,
      { pitch: pitch.value, volume: volume.value, gap: gap.value, background: background.value },
      (value) => { progress.value = Math.max(0, Math.min(100, value * 100)); },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    const samples = result.samples as Float32Array<ArrayBuffer>;
    rendered.value = { ...result, samples };
    downloadUrl = URL.createObjectURL(encodeWav(samples, result.sampleRate));
    renderMessage.value = "Announcement ready";
    progress.value = 100;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      renderMessage.value = "Rendering cancelled";
    } else {
      renderMessage.value = error instanceof Error ? error.message : "Audio rendering failed";
    }
  } finally {
    if (renderController === controller) {
      renderController = null;
      rendering.value = false;
    }
  }
}

async function exportOpus() {
  if (!rendered.value || encodingOpus.value || rendering.value) return;
  encodingOpus.value = true;
  progress.value = 0;
  opusMessage.value = "Loading Opus encoder…";
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  const controller = new AbortController();
  renderController = controller;
  try {
    const { encodeOpus } = await import("./audio/export");
    const blob = await encodeOpus(
      rendered.value.samples,
      rendered.value.sampleRate,
      (value) => { progress.value = Math.max(0, Math.min(100, value * 100)); },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    opusUrl.value = URL.createObjectURL(blob);
    opusMessage.value = "Opus file ready";
    progress.value = 100;
  } catch (error) {
    opusMessage.value = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "Encoding cancelled"
      : error instanceof Error ? error.message : "Opus encoding failed";
  } finally {
    if (renderController === controller) {
      renderController = null;
      encodingOpus.value = false;
    }
  }
}

async function preview() {
  if (!rendered.value) return;
  audioError.value = "";
  try {
    audioContext ??= new AudioContext();
    await audioContext.resume();
    stopPlayback();
    const buffer = audioContext.createBuffer(1, rendered.value.samples.length, rendered.value.sampleRate);
    buffer.copyToChannel(rendered.value.samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      if (activeSource === source) {
        activeSource = null;
        playing.value = false;
      }
    };
    activeSource = source;
    playing.value = true;
    source.start();
  } catch (error) {
    audioError.value = error instanceof Error ? error.message : "Audio playback is unavailable in this browser";
  }
}

function insertClip(id: string) {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  const leading = before.length && !/\s$/.test(before) ? " " : "";
  const trailing = after.length && !/^\s/.test(after) ? " " : "";
  text.value = before + leading + id + trailing + after;
  requestAnimationFrame(() => {
    field?.focus();
    const caret = start + leading.length + id.length + trailing.length;
    field?.setSelectionRange(caret, caret);
  });
}

function reloadApp() {
  window.location.reload();
}

function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey &&
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable))) {
    event.preventDefault();
    shellElement.value?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }
}

watch([query, kindFilter], () => { visibleLimit.value = 16; });
watch(text, () => {
  rendered.value = null;
  renderMessage.value = "";
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = "";
});
watch(darkMode, (value) => {
  try { localStorage.setItem("cassie-theme", value ? "dark" : "light"); } catch { /* Storage may be disabled. */ }
});
onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown);
  try { darkMode.value = localStorage.getItem("cassie-theme") !== "light"; } catch { darkMode.value = true; }
  try { bank.value = await loadBank(); }
  catch (error) { loadError.value = error instanceof Error ? error.message : "The voice bank could not be loaded"; }
  finally { loading.value = false; }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  renderController?.abort();
  stopPlayback();
  void audioContext?.close();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
});
</script>

<template>
  <FluentTheme :mode="themeMode" accent="#a7f36c">
    <div ref="shellElement" class="studio-shell" :class="{ 'is-light': !darkMode }">
      <header class="topbar">
        <a class="brand" href="#main" aria-label="CASSIE studio home">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <span class="brand-copy"><strong>CASSIE</strong><small>ANNOUNCEMENT STUDIO</small></span>
        </a>
        <div class="topbar-center"><span class="live-dot"></span><span>LOCAL AUDIO ENGINE</span><span class="topbar-divider">/</span><span>NO CLOUD PROCESSING</span></div>
        <div class="topbar-actions">
          <a class="docs-link" href="https://github.com/lsy-404/CASSIE" target="_blank" rel="noreferrer">SOURCE <span aria-hidden="true">↗</span></a>
          <button class="theme-button" type="button" :aria-label="darkMode ? 'Switch to light theme' : 'Switch to dark theme'" @click="darkMode = !darkMode">
            <svg v-if="darkMode" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.3"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2m12.4 0h2M4.2 4.2l1.4 1.4m8.8 8.8 1.4 1.4m0-11.6-1.4 1.4m-8.8 8.8-1.4 1.4"/></svg>
            <svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7.3 7.3 0 1 0 9 9Z"/></svg>
          </button>
        </div>
      </header>
      <main id="main" class="workspace">
        <section class="page-heading">
          <div><div class="eyebrow"><span class="eyebrow-line"></span> FACILITY PA SYSTEM <span class="eyebrow-index">01 — COMPOSER</span></div><h1>Voice <em>transmission</em></h1><p class="page-description">Compose, tune and render a facility announcement.</p></div>
          <div class="engine-status" :class="{ 'is-ready': bank }" role="status"><span class="engine-status-icon"><span></span></span><div><strong>{{ loading ? "INITIALIZING" : bank ? "ENGINE READY" : "ENGINE OFFLINE" }}</strong><small>{{ bank ? bank.clips.length.toLocaleString() + " VOICE ASSETS" : loading ? "LOADING LOCAL VOICE BANK" : "CHECK CONNECTION & RELOAD" }}</small></div></div>
        </section>
        <div v-if="loading" class="loading-banner" role="status"><span class="spinner"></span> Preparing the local voice bank…</div>
        <div v-else-if="loadError" class="error-banner" role="alert"><span class="alert-glyph">!</span><div><strong>Voice bank unavailable</strong><p>{{ loadError }}</p></div><FluentButton tone="secondary" @click="reloadApp">Retry</FluentButton></div>

        <div class="studio-grid">
          <section class="main-column" aria-label="Announcement composer">
            <article class="panel phrase-panel">
              <div class="panel-heading"><div class="panel-title-wrap"><span class="step-number">01</span><div><h2>Announcement script</h2><p>Enter text or build a phrase from the voice bank.</p></div></div><span class="field-meta">{{ text.trim().length }} CHARACTERS</span></div>
              <div class="phrase-input-wrap">
                <FluentField v-model="text" label="Announcement script" multiline :disabled="!bank || rendering || encodingOpus" placeholder="Type an announcement…" />
                <span class="input-corner input-corner-top"></span><span class="input-corner input-corner-bottom"></span>
              </div>
              <div class="token-summary"><div class="token-label"><span class="mini-wave"><i></i><i></i><i></i><i></i><i></i></span> RECOGNIZED WORDS <span class="token-count">{{ analysis.words.length }}</span></div>
                <div v-if="analysis.words.length" class="word-chips" aria-label="Recognized words"><span v-for="(word, index) in analysis.words.slice(0, 14)" :key="word + '-' + index" class="word-chip">{{ word }}</span><span v-if="analysis.words.length > 14" class="word-chip word-chip-more">+{{ analysis.words.length - 14 }}</span></div>
                <span v-else class="empty-inline">Your phrase tokens will appear here</span>
              </div>
              <div v-if="analysis.warnings.length" class="inline-warning" role="status"><span class="warning-mark">!</span><span>{{ analysis.warnings[0] }}</span><span v-if="analysis.warnings.length > 1" class="warning-tail">+{{ analysis.warnings.length - 1 }} MORE</span></div>
            </article>

            <article class="panel library-panel">
              <div class="panel-heading library-heading"><div class="panel-title-wrap"><span class="step-number">02</span><div><h2>Voice bank</h2><p>Search and select a clip to insert at the cursor.</p></div></div><span class="asset-count"><span></span>{{ bank?.clips.length ?? 0 }} CLIPS</span></div>
              <div class="library-toolbar">
                <label class="search-box"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4"/></svg><input v-model="query" type="search" placeholder="Search voice clips" aria-label="Search voice clips" /><kbd>/</kbd></label>
                <div class="filter-tabs" role="group" aria-label="Filter voice clips"><button v-for="filter in kindFilters" :key="filter.value" type="button" :class="{ active: kindFilter === filter.value }" @click="kindFilter = filter.value">{{ filter.label }}</button></div>
              </div>
              <div v-if="visibleClips.length" class="clip-list" role="list" aria-label="Available voice clips">
                <button v-for="clip in visibleClips" :key="clip.id" class="clip-row" type="button" role="listitem" :title="'Insert ' + clip.id" @click="insertClip(clip.id)"><span class="clip-play" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m5.5 3.8 6.2 4.2-6.2 4.2z"/></svg></span><span class="clip-name">{{ clip.id }}</span><span class="clip-kind">{{ clip.kind === "effect" ? "EFFECT" : "VOICE" }}</span><span class="clip-duration">{{ clip.duration.toFixed(1) }}s</span><span class="clip-insert" aria-hidden="true">＋</span></button>
              </div>
              <div v-else class="empty-library"><span>⌕</span><strong>No clips found</strong><small>Try a different search or filter.</small></div>
              <button v-if="visibleClips.length < matchingClips.length" class="show-more" type="button" @click="visibleLimit += 16">SHOW MORE <span>{{ matchingClips.length - visibleClips.length }} REMAINING</span><b aria-hidden="true">↓</b></button>
              <div class="library-footer"><span>Click a clip to insert it into your script</span><span class="library-footer-right">{{ matchingClips.length }} RESULTS</span></div>
            </article>
          </section>

          <aside class="side-column" aria-label="Voice settings and render controls">
            <article class="panel settings-panel">
              <div class="panel-heading compact-heading"><div class="panel-title-wrap"><span class="step-number">03</span><div><h2>Voice profile</h2><p>Adjust playback characteristics.</p></div></div></div>
              <div class="preset-block"><span class="control-label">PRESET</span><div class="preset-options" role="group" aria-label="Voice presets"><button v-for="item in presetOptions" :key="item.value" type="button" :class="{ selected: preset === item.value }" @click="applyPreset(item.value)"><span class="preset-indicator"></span>{{ item.label }}</button></div></div>
              <div class="settings-divider"></div>
              <div class="slider-control"><div class="control-label-row"><span class="control-label">PITCH</span><span class="control-value">{{ pitch.toFixed(2) }}<small>×</small></span></div><FluentSlider v-model="pitch" :min="0.65" :max="1.35" :step="0.01" aria-label="Pitch" /><div class="slider-scale"><span>LOW</span><span>HIGH</span></div></div>
              <div class="slider-control"><div class="control-label-row"><span class="control-label">VOLUME</span><span class="control-value">{{ Math.round(volume * 100) }}<small>%</small></span></div><FluentSlider v-model="volume" :min="0.1" :max="1" :step="0.01" aria-label="Volume" /><div class="slider-scale"><span>SOFT</span><span>FULL</span></div></div>
              <div class="slider-control"><div class="control-label-row"><span class="control-label">WORD SPACING</span><span class="control-value">{{ gap.toFixed(2) }}<small>s</small></span></div><FluentSlider v-model="gap" :min="0" :max="0.8" :step="0.01" aria-label="Word spacing" /><div class="slider-scale"><span>TIGHT</span><span>SPACED</span></div></div>
              <div class="settings-divider lower-divider"></div>
              <div class="ambient-row"><div><strong>Ambient bed</strong><small>Subtle facility room tone</small></div><FluentSwitch v-model="background" aria-label="Ambient background sound" /></div>
            </article>

            <article class="panel output-panel">
              <div class="panel-heading compact-heading output-heading"><div class="panel-title-wrap"><span class="step-number">04</span><div><h2>Render output</h2><p>Process locally in your browser.</p></div></div></div>
              <div class="output-format"><span class="format-icon">WAV</span><div><strong>WAVE AUDIO</strong><small>16-bit · Mono · {{ rendered?.sampleRate ?? 44100 }} Hz</small></div><span class="format-local"><span></span>LOCAL</span></div>
              <div v-if="rendering || encodingOpus || rendered" class="render-progress-block" aria-live="polite"><div class="progress-label-row"><span>{{ encodingOpus ? "ENCODING OPUS" : rendering ? "RENDERING ANNOUNCEMENT" : opusUrl ? "OPUS READY" : "RENDER COMPLETE" }}</span><span>{{ rendering || encodingOpus ? Math.round(progress) + "%" : rendered ? rendered.duration.toFixed(1) + "s" : "" }}</span></div><FluentProgressBar :value="progress" :max="100" :indeterminate="(rendering || encodingOpus) && progress === 0" :show-indicator="false" /><span class="progress-status">{{ encodingOpus ? opusMessage : rendering ? "Synthesizing voice clips in WebAssembly…" : opusUrl ? opusMessage : renderMessage }}</span></div>
              <div v-else class="ready-hint"><span class="hint-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span>Your announcement is ready to compose</span></div>
              <p v-if="renderMessage && !rendering && !rendered" class="render-error" role="status">{{ renderMessage }}</p><p v-if="audioError" class="render-error" role="alert">{{ audioError }}</p>
              <div v-if="allWarnings.length" class="render-warnings" role="status"><span>!</span><div><strong>Some words may be skipped</strong><small>{{ allWarnings[0] }}<template v-if="allWarnings.length > 1"> · +{{ allWarnings.length - 1 }} more</template></small></div></div>
              <div class="output-actions">
                <FluentButton v-if="rendering || encodingOpus" class="compose-button cancel-button" tone="secondary" @click="cancelRender"><span class="button-square" aria-hidden="true"></span> CANCEL {{ encodingOpus ? "ENCODING" : "RENDER" }}</FluentButton>
                <FluentButton v-else class="compose-button" tone="primary" :disabled="!bank || !text.trim()" @click="compose"><span class="button-bars" aria-hidden="true"><i></i><i></i><i></i></span> {{ rendered ? "RENDER AGAIN" : "COMPOSE AUDIO" }} <span class="button-arrow" aria-hidden="true">→</span></FluentButton>
                <div v-if="rendered" class="secondary-actions"><FluentButton tone="secondary" @click="playing ? stopPlayback() : preview()"><span aria-hidden="true">{{ playing ? "■" : "▶" }}</span> {{ playing ? "STOP PREVIEW" : "PREVIEW" }}</FluentButton><a v-if="downloadUrl" class="download-button" :href="downloadUrl" download="cassie-announcement.wav" aria-label="Download WAV file"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10m0 0 4-4m-4 4L6 8M3 14v3h14v-3"/></svg><span>WAV</span></a><FluentButton v-if="!opusUrl" tone="secondary" :disabled="encodingOpus || rendering" @click="exportOpus"><span aria-hidden="true">↘</span> {{ encodingOpus ? "ENCODING…" : "OPUS" }}</FluentButton><a v-else class="download-button opus-download" :href="opusUrl" download="cassie-announcement.opus" aria-label="Download Opus file"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10m0 0 4-4m-4 4L6 8M3 14v3h14v-3"/></svg><span>OPUS</span></a></div>
              </div>
              <div class="local-note"><span>◇</span> YOUR SCRIPT AND AUDIO STAY ON THIS DEVICE</div>
            </article>
            <div class="syntax-note"><span class="syntax-icon">⌘</span><p><strong>Modifier syntax</strong><br />Use <code>$PITCH_1.1</code>, <code>$VOL_0.8</code> or <code>$SLEEP_0.5</code> inline.</p><a href="https://github.com/lsy-404/CASSIE#modifiers" target="_blank" rel="noreferrer" aria-label="Read modifier syntax documentation">↗</a></div>
          </aside>
        </div>
      </main>
      <footer class="footer"><span>VOICE SYSTEM <b>·</b> CASSIE STUDIO</span><span>CLIENT-SIDE AUDIO PROCESSING <i></i> NO DATA UPLOAD</span><span><a href="https://github.com/lsy-404/CASSIE">SOURCE</a><b> · </b><a href="/licenses.html">LICENSES</a></span></footer>
    </div>
  </FluentTheme>
</template>
