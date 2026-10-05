<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  FluentButton, FluentCheckbox, FluentField, FluentNotice, FluentProgressBar,
  FluentSlider, FluentTheme,
} from "@platform-kit/fluent/vue";
import { analyzeAnnouncement, encodeWav, loadBank, renderAnnouncement, type AnalysisToken as EngineAnalysisToken, type TimelineEntry } from "./audio/engine";
import { checkEnglishSpelling } from "./spelling";

type Bank = Awaited<ReturnType<typeof loadBank>>;
type AnalysisToken = EngineAnalysisToken & { spellingMissing?: boolean };
type RenderedAnnouncement = Omit<Awaited<ReturnType<typeof renderAnnouncement>>, "samples"> & { samples: Float32Array<ArrayBuffer>; timeline: TimelineEntry[] };
const bank = ref<Bank | null>(null);
const loading = ref(true);
const loadError = ref("");
const text = ref([
  "<start>",
  "CASSIE: Attention all personnel.",
  '<pitch value="1.2">Security</pitch> <volume value="0.7">alert</volume>.',
  'me<pitch value="1.1">tri</pitch>cs need review.',
  "ROC AUC I a A",
  '<stutter repeats="1">Attention</stutter><pause seconds="0.5"/>',
  "<br>",
  '<offset seconds="0.1">Lockdown</offset> <duration seconds="0.3">ends</duration> <spacing seconds="0.2">now</spacing>.',
  '<clip id="cassie"/>',
  "/ a e: / <end>",
].join("\n"));
const pitch = ref(1);
const volume = ref(1);
const gap = ref(0.24);
const liveRender = ref(true);
const primaryInsertions = [
  { label: "开始", kind: "marker", value: "<start>" },
  { label: "结束", kind: "marker", value: "<end>" },
  { label: "停顿", kind: "marker", value: '<pause seconds="0.5"/>' },
  { label: "卡顿", kind: "scope", open: '<stutter repeats="3">', close: "</stutter>" },
] as const;
const scopedInsertions = [
  { label: "音高", open: '<pitch value="1.2">', close: "</pitch>" },
  { label: "音量", open: '<volume value="0.7">', close: "</volume>" },
  { label: "偏移", open: '<offset seconds="0.1">', close: "</offset>" },
  { label: "时长", open: '<duration seconds="0.3">', close: "</duration>" },
  { label: "间隔", open: '<spacing seconds="0.2">', close: "</spacing>" },
] as const;
const progress = ref(0);
const rendering = ref(false);
const renderMessage = ref("");
const rendered = ref<RenderedAnnouncement | null>(null);
const encodingOpus = ref(false);
const opusMessage = ref("");
const opusUrl = ref("");
const phoneKeys = ref<string[]>([]);
const phoneIndexError = ref("");
const analysis = ref<{ words: string[]; warnings: string[]; ipa: string[]; tokens: AnalysisToken[] }>({ words: [], warnings: [], ipa: [], tokens: [] });
const shellElement = ref<HTMLElement | null>(null);
const audioElement = ref<HTMLAudioElement | null>(null);
const audioTime = ref(0);
const editorScrollTop = ref(0);
const editorScrollbarWidth = ref(0);
const editorScrollLeft = ref(0);

let renderController: AbortController | null = null;
let analysisRevision = 0;
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
let analysisController: AbortController | null = null;
let downloadUrl = "";

const allWarnings = computed(() => [...new Set([...analysis.value.warnings, ...(rendered.value?.warnings ?? [])])]);
const activeTimelineItem = computed(() => rendered.value?.timeline?.find((item) => audioTime.value >= item.startSeconds && audioTime.value < item.endSeconds) ?? null);
const editorParts = computed(() => {
  const timeline = rendered.value?.timeline ?? [];
  const boundaries = new Set([0, text.value.length]);
  for (const token of analysis.value.tokens) { boundaries.add(token.sourceStart); boundaries.add(token.sourceEnd); }
  for (const item of timeline) { boundaries.add(item.sourceStart); boundaries.add(item.sourceEnd); }
  const ordered = [...boundaries].filter((value) => value >= 0 && value <= text.value.length).sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1];
    const token = analysis.value.tokens.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const timing = timeline.find((item) => start >= item.sourceStart && start < item.sourceEnd);
    const kind = token?.kind ?? (timing?.kind === "gap" ? "gap" : "neutral");
    return { key: `${start}-${end}`, text: text.value.slice(start, end), kind, spellingMissing: Boolean(token?.spellingMissing), active: Boolean(activeTimelineItem.value && start >= activeTimelineItem.value.sourceStart && start < activeTimelineItem.value.sourceEnd), label: token?.spellingMissing ? "词典未收录，仍可合成" : kind === "recorded" ? "原始录音" : kind === "synthesized" ? "合成音频" : kind === "marker" ? "识别命令" : kind === "gap" ? "间隔" : kind === "error" ? "渲染错误" : "普通文本" };
  });
});

function replaceEditorRange(value: string, selection?: { start: number; end: number }) {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  text.value = before + value + after;
  requestAnimationFrame(() => {
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
  text.value = before + value + selected + after;
  requestAnimationFrame(() => {
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
  audioElement.value?.pause();
}
function cancelRender() {
  renderController?.abort();
  renderController = null;
  rendering.value = false;
  encodingOpus.value = false;
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  opusMessage.value = "编码已取消";
  renderMessage.value = "渲染已取消";
}
async function compose() {
  if (!bank.value || !text.value.trim() || rendering.value || encodingOpus.value) return;
  stopPlayback();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  downloadUrl = "";
  opusUrl.value = "";
  opusMessage.value = "";
  rendered.value = null;
  renderMessage.value = "正在准备音频引擎…";
  progress.value = 0;
  rendering.value = true;
  const controller = new AbortController();
  renderController = controller;
  try {
    const result = await renderAnnouncement(text.value, bank.value,
      { pitch: pitch.value, volume: volume.value, gap: gap.value, phonemes: true },
      (value) => { progress.value = Math.max(0, Math.min(100, value * 100)); }, controller.signal);
    if (controller.signal.aborted) return;
    const samples = result.samples as Float32Array<ArrayBuffer>;
    rendered.value = { ...result, samples };
    downloadUrl = URL.createObjectURL(encodeWav(samples, result.sampleRate));
    renderMessage.value = "公告已就绪";
    progress.value = 100;
  } catch (error) {
    renderMessage.value = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "渲染已取消" : error instanceof Error ? error.message : "音频渲染失败";
  } finally {
    if (renderController === controller) { renderController = null; rendering.value = false; }
  }
}
async function exportOpus() {
  if (!rendered.value || encodingOpus.value || rendering.value) return;
  encodingOpus.value = true;
  progress.value = 0;
  opusMessage.value = "正在加载 Opus 编码器…";
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
    opusMessage.value = "Opus 文件已就绪";
    progress.value = 100;
  } catch (error) {
    opusMessage.value = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "编码已取消" : error instanceof Error ? error.message : "Opus 编码失败";
  } finally {
    if (renderController === controller) { renderController = null; encodingOpus.value = false; }
  }
}
function onAudioTimeUpdate() { audioTime.value = audioElement.value?.currentTime ?? 0; }
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
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = "";
}
watch([text, pitch, volume, gap, bank], () => {
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
    if (!response.ok) throw new Error("无法加载音素索引");
    const data = await response.json() as { phones?: Record<string, unknown> };
    phoneKeys.value = Object.keys(data.phones ?? {}).sort((left, right) => left.localeCompare(right));
  }).catch((error) => { phoneIndexError.value = error instanceof Error ? error.message : "无法加载音素索引"; });
  try { bank.value = await loadBank(); }
  catch (error) { loadError.value = error instanceof Error ? error.message : "语音素材库无法加载"; }
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
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
});
</script>

<template>
  <FluentTheme mode="system">
    <div ref="shellElement" class="studio-shell">
      <header class="topbar">
        <a class="brand" href="#main"><strong>CASSIE</strong><span>公告编辑器</span></a>
        <a href="https://github.com/lsy-404/CASSIE" target="_blank" rel="noreferrer">项目源码 ↗</a>
      </header>
      <main id="main" class="workspace">
        <section class="page-heading"><div><p>本地音频工作室</p><h1>公告编辑器</h1><p>直接输入英文单词，也可手敲语音标签或 / 音素 /。</p></div></section>
        <FluentNotice v-if="loading">正在准备本地语音素材库…</FluentNotice>
        <FluentNotice v-else-if="loadError" tone="danger">{{ loadError }} <FluentButton tone="secondary" @click="reloadApp">重试</FluentButton></FluentNotice>
        <div class="studio-grid">
          <section class="main-column" aria-label="公告编辑">
            <section class="panel">
              <div class="panel-heading"><div><h2>公告内容</h2><p>直接输入英文单词，也可手敲语音标签或 / 音素 /。</p></div><span>{{ text.length }} 字符</span></div>
              <div class="authoring-tools">
                <div class="tool-group"><strong>插入语音标签</strong>
                  <FluentButton v-for="command in primaryInsertions" :key="command.label" tone="secondary" :disabled="!bank || encodingOpus" @click="command.kind === 'scope' ? insertScope(command.open, command.close) : insertMarker(command.value)">{{ command.label }}</FluentButton>
                </div>
                <p class="markup-inline-note">词内效果示例：<code>me&lt;pitch value="1.2"&gt;tri&lt;/pitch&gt;cs</code></p>
                <details class="advanced-tools"><summary>音效标签与用法</summary>
                  <div class="tool-group"><FluentButton v-for="command in scopedInsertions" :key="command.label" tone="subtle" :disabled="!bank || encodingOpus" @click="insertScope(command.open, command.close)">{{ command.label }}</FluentButton><FluentButton tone="subtle" :disabled="!bank || encodingOpus" @click="insertClip">素材片段</FluentButton><FluentButton tone="subtle" :disabled="!bank || encodingOpus" @click="replaceEditorRange('/ a e: /')">插入音素</FluentButton></div>
                  <div class="help-examples">
                    <p>整词效果：<code>&lt;pitch value="1.2"&gt;attention&lt;/pitch&gt;</code>。卡顿的 <code>repeats</code> 表示原始片段之后额外重复的次数。</p>
                    <p>可把插入点放在词中；标签不会自动添加空格。选择文字后点效果按钮会包住选区；没有选区时会插入并选中英文单词 <code>word</code>，可直接替换。闭合标签也可手动输入。</p>
                    <p>独立标记可自闭或省略尾斜线：<code>&lt;start&gt;</code>/<code>&lt;start/&gt;</code> 与 <code>&lt;end&gt;</code>/<code>&lt;end/&gt;</code> 等效。<code>&lt;br&gt;</code> 或 <code>&lt;br/&gt;</code> 会停顿 0.5 秒。</p>
                    <p>停顿：<code>&lt;pause seconds="0.5"&gt;</code> 或 <code>&lt;pause seconds="0.5"/&gt;</code>；素材：<code>&lt;clip id="cassie"&gt;</code> 或 <code>&lt;clip id="cassie"/&gt;</code>，将 ID 换成素材 ID。</p>
                    <p>直接音素：<code>/ a e: /</code>。已收录英文按大小写不敏感匹配；未收录的全大写词按英文字母名朗读。示例里的大写 <code>A</code> 是字母名，小写 <code>a</code> 是冠词，单独的 <code>I</code> 是代词。</p>
                  </div>
                </details>
              </div>
              <div class="phrase-field annotated-editor"><FluentField v-model="text" label="公告内容" multiline wrap="soft" :disabled="!bank || encodingOpus" placeholder="输入公告内容…" @scroll="onEditorScroll" @input="onEditorInput" /><div class="highlight-clip" :style="{ '--editor-scroll': `${editorScrollTop}px`, '--editor-scroll-left': `${editorScrollLeft}px`, '--editor-scrollbar-width': `${editorScrollbarWidth}px` }" aria-hidden="true"><pre class="highlight-layer"><span v-for="part in editorParts" :key="part.key" :class="[`token-${part.kind}`, { active: part.active, 'spell-missing': part.spellingMissing }]" :title="part.label">{{ part.text }}</span></pre></div></div>
              <div class="token-legend" aria-label="文本标记说明"><span class="token-recorded">原始录音</span><span class="token-synthesized">合成音频</span><span class="spell-legend">拼写提示（仍尝试合成）</span><span class="token-marker">识别命令</span><span class="token-error">近似或错误</span></div>
              <audio v-if="rendered" ref="audioElement" class="audio-player" controls :src="downloadUrl" aria-label="公告音频播放器" @timeupdate="onAudioTimeUpdate" @seeking="onAudioTimeUpdate" />
              <div class="live-controls"><FluentCheckbox v-model="liveRender" aria-label="实时渲染">实时渲染</FluentCheckbox><small>更新音频但不自动播放</small></div>
              <details v-if="analysis.words.length || analysis.ipa.length || analysis.warnings.length" class="analysis-details"><summary>语音分析与提示</summary><p>识别到 {{ analysis.words.length }} 个语音片段<span v-if="analysis.ipa.length"> · 音素 {{ analysis.ipa.join(' · ') }}</span></p><FluentNotice v-if="analysis.warnings.length" tone="warning">{{ analysis.warnings[0] }}<span v-if="analysis.warnings.length > 1">（另有 {{ analysis.warnings.length - 1 }} 条提示）</span></FluentNotice></details>
            </section>
          </section>
          <aside class="side-column" aria-label="渲染设置">
            <section class="panel">
              <div class="panel-heading"><div><h2>声音设置</h2><p>调整本次公告的全局混音。</p></div></div>
              <div class="settings">
                <label><span>音高 <b>{{ pitch.toFixed(2) }}×</b></span><FluentSlider v-model="pitch" :min="0.65" :max="1.35" :step="0.01" aria-label="音高" /></label>
                <label><span>音量 <b>{{ Math.round(volume * 100) }}%</b></span><FluentSlider v-model="volume" :min="0.1" :max="1" :step="0.01" aria-label="音量" /></label>
                <label><span>词间间隔 <b>{{ gap.toFixed(2) }}s</b></span><FluentSlider v-model="gap" :min="0" :max="0.8" :step="0.01" aria-label="词间间隔" /></label>
                <div class="phoneme-setting"><span>未收录词合成<small>优先使用录音，缺少时尝试音素拼合</small></span><span class="setting-state">已开启</span></div>
                <details class="phone-inventory"><summary>可用音素（{{ phoneKeys.length }}）</summary><span v-if="phoneIndexError">{{ phoneIndexError }}</span><div v-else class="phone-list"><FluentButton v-for="phone in phoneKeys" :key="phone" tone="subtle" :aria-label="`插入音素 ${phone}`" :title="`插入 / ${phone} /`" @click="replaceEditorRange(`/ ${phone} /`)">{{ phone }}</FluentButton></div></details>
              </div>
            </section>
            <section class="panel output-panel">
              <div class="panel-heading"><div><h2>渲染与导出</h2><p>音频在本机生成，不会上传文本。</p></div></div>
              <div v-if="rendering || encodingOpus" class="render-progress"><FluentProgressBar :value="progress" :max="100" :label="rendering ? '正在渲染公告音频' : '正在编码 Opus'" /><span>{{ rendering ? "正在渲染" : "正在编码" }} · {{ Math.round(progress) }}%</span></div>
              <FluentNotice v-if="renderMessage" :tone="rendered ? 'success' : renderMessage.includes('取消') ? 'info' : 'danger'">{{ renderMessage }}</FluentNotice>
              <FluentNotice v-if="opusMessage" :tone="opusUrl ? 'success' : opusMessage.includes('取消') ? 'info' : 'danger'">{{ opusMessage }}</FluentNotice>
              <FluentNotice v-if="allWarnings.length" tone="warning"><strong>渲染提示</strong><span v-for="warning in allWarnings.slice(0, 4)" :key="warning" class="warning-item">{{ warning }}</span></FluentNotice>
              <div class="output-actions">
                <FluentButton v-if="rendering || encodingOpus" tone="danger" @click="cancelRender">取消任务</FluentButton>
                <FluentButton v-else-if="!liveRender" tone="primary" :disabled="!bank || !text.trim()" :busy="rendering" @click="compose">生成公告音频</FluentButton>
                <template v-if="rendered">
                  <a v-if="downloadUrl" class="download-link" :href="downloadUrl" download="cassie-announcement.wav">下载 WAV</a>
                  <FluentButton v-if="!opusUrl" tone="secondary" :busy="encodingOpus" :disabled="encodingOpus" @click="exportOpus">导出 Opus</FluentButton>
                  <a v-else class="download-link" :href="opusUrl" download="cassie-announcement.opus">下载 Opus</a>
                </template>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <footer class="footer">CASSIE <span>·</span> 本地语音素材公告编辑器 <span>·</span> <a href="https://github.com/lsy-404/CASSIE">源代码</a> <span>·</span> <a href="/licenses.html">AGPL-3.0 与第三方许可</a></footer>
    </div>
  </FluentTheme>
</template>
