<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  FluentButton, FluentField, FluentNotice, FluentProgressBar, FluentSelect,
  FluentSlider, FluentSwitch, FluentTheme, FluentToggleButton,
} from "@platform-kit/fluent/vue";
import { analyzeAnnouncement, encodeWav, loadBank, renderAnnouncement } from "./audio/engine";
import { announcementCueIds, getClipUsage } from "./audio/catalog";
import type { BankClip } from "./audio/types";

type Bank = Awaited<ReturnType<typeof loadBank>>;
type RenderedAnnouncement = Omit<Awaited<ReturnType<typeof renderAnnouncement>>, "samples"> & { samples: Float32Array<ArrayBuffer> };
const bank = ref<Bank | null>(null);
const loading = ref(true);
const loadError = ref("");
const text = ref("Attention all personnel. The facility is now under lockdown.");
const pitch = ref(1);
const volume = ref(1);
const gap = ref(0.24);
const background = ref(false);
const phonemes = ref(false);
const selectedStartCue = ref<string | null>(announcementCueIds.start);
const selectedEndCue = ref<string | null>(announcementCueIds.end);
const query = ref("");
const kindFilter = ref<"all" | "word" | "effect">("all");
const categoryFilter = ref("all");
const visibleLimit = ref(24);
const progress = ref(0);
const rendering = ref(false);
const renderMessage = ref("");
const rendered = ref<RenderedAnnouncement | null>(null);
const playing = ref(false);
const audioError = ref("");
const encodingOpus = ref(false);
const opusMessage = ref("");
const opusUrl = ref("");
const previewing = ref("");
const phoneKeys = ref<string[]>([]);
const phoneIndexError = ref("");
const analysis = ref<{ words: string[]; warnings: string[]; ipa: string[] }>({ words: [], warnings: [], ipa: [] });
const shellElement = ref<HTMLElement | null>(null);

let renderController: AbortController | null = null;
let previewController: AbortController | null = null;
let analysisRevision = 0;
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
let analysisController: AbortController | null = null;
let audioContext: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let downloadUrl = "";

const allWarnings = computed(() => [...analysis.value.warnings, ...(rendered.value?.warnings ?? [])]);
const matchingClips = computed(() => (bank.value?.clips ?? []).filter((clip) => {
  const usage = getClipUsage(clip);
  const kindMatches = kindFilter.value === "all" || clip.kind === kindFilter.value;
  const categoryMatches = categoryFilter.value === "all" || usage.category === categoryFilter.value;
  const needle = query.value.trim().toLocaleLowerCase();
  return kindMatches && categoryMatches && (!needle || `${clip.id} ${clip.file} ${usage.label} ${usage.category}`.toLocaleLowerCase().includes(needle));
}));
const visibleClips = computed(() => matchingClips.value.slice(0, visibleLimit.value));
const categoryOptions = computed(() => [
  { value: "all", label: "全部分类" },
  ...[...new Set((bank.value?.clips ?? []).map((clip) => getClipUsage(clip).category))].sort().map((value) => ({ value, label: value })),
]);
const selectedStartCueLabel = computed(() => bank.value?.clips.find((clip) => clip.id === selectedStartCue.value)?.id ?? "未选择");
const selectedEndCueLabel = computed(() => bank.value?.clips.find((clip) => clip.id === selectedEndCue.value)?.id ?? "未选择");
const kindOptions = [
  { value: "all" as const, label: "全部" },
  { value: "word" as const, label: "语音" },
  { value: "effect" as const, label: "效果" },
];

function insertText(value: string) {
  const field = shellElement.value?.querySelector("textarea") ?? null;
  const start = field?.selectionStart ?? text.value.length;
  const end = field?.selectionEnd ?? start;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  const leading = before.length && !/\s$/.test(before) ? " " : "";
  const trailing = after.length && !/^\s/.test(after) ? " " : "";
  text.value = before + leading + value + trailing + after;
  requestAnimationFrame(() => {
    field?.focus();
    const caret = start + leading.length + value.length + trailing.length;
    field?.setSelectionRange(caret, caret);
  });
}
function scheduleAnalysis() {
  const revision = ++analysisRevision;
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisController?.abort();
  analysisController = null;
  if (!bank.value) { analysis.value = { words: [], warnings: [], ipa: [] }; return; }
  analysisTimer = setTimeout(async () => {
    const currentBank = bank.value;
    if (!currentBank) return;
    const controller = new AbortController();
    analysisController = controller;
    try {
      const result = await analyzeAnnouncement(text.value, currentBank, phonemes.value, controller.signal);
      if (!controller.signal.aborted && revision === analysisRevision) analysis.value = result;
    } catch (error) {
      if (!controller.signal.aborted && revision === analysisRevision) analysis.value = { words: [], warnings: [error instanceof Error ? error.message : "无法分析公告文本"], ipa: [] };
    } finally {
      if (analysisController === controller) analysisController = null;
    }
  }, 120);
}
function insertClip(clip: BankClip) { insertText(getClipUsage(clip).insertText); }
function insertCue(which: "start" | "end") {
  const id = which === "start" ? selectedStartCue.value : selectedEndCue.value;
  if (id) insertText(`$CLIP_${id}`);
}
function setCue(which: "start" | "end", clip: BankClip) {
  if (which === "start") selectedStartCue.value = clip.id;
  else selectedEndCue.value = clip.id;
}
function stopPlayback() {
  previewController?.abort();
  previewController = null;
  previewing.value = "";
  if (!activeSource) return;
  const source = activeSource;
  activeSource = null;
  source.onended = null;
  source.stop();
  playing.value = false;
}
function cancelRender() {
  stopPlayback();
  renderController?.abort();
  renderController = null;
  rendering.value = false;
  encodingOpus.value = false;
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  opusMessage.value = "Encoding cancelled";
  renderMessage.value = "Rendering cancelled";
}
async function playSamples(samples: Float32Array, sampleRate: number) {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  stopPlayback();
  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  const channelData = new Float32Array(samples.length);
  channelData.set(samples);
  buffer.copyToChannel(channelData, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    if (activeSource === source) { activeSource = null; playing.value = false; previewing.value = ""; }
  };
  activeSource = source;
  playing.value = true;
  source.start();
}
async function previewClip(clip: BankClip) {
  if (!bank.value || previewing.value) return;
  stopPlayback();
  audioError.value = "";
  previewing.value = clip.id;
  const controller = new AbortController();
  previewController = controller;
  try {
    const result = await renderAnnouncement(getClipUsage(clip).insertText, bank.value,
      { pitch: 1, volume: 1, gap: 0, background: false }, undefined, controller.signal);
    if (!controller.signal.aborted) await playSamples(result.samples, result.sampleRate);
  } catch (error) {
    if (!controller.signal.aborted) audioError.value = error instanceof Error ? error.message : "素材试听失败";
    previewing.value = "";
  } finally {
    if (previewController === controller) previewController = null;
  }
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
      { pitch: pitch.value, volume: volume.value, gap: gap.value, background: background.value, phonemes: phonemes.value },
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
async function preview() {
  if (!rendered.value) return;
  audioError.value = "";
  try { await playSamples(rendered.value.samples, rendered.value.sampleRate); }
  catch (error) { audioError.value = error instanceof Error ? error.message : "浏览器无法播放音频"; }
}
function reloadApp() { window.location.reload(); }
function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey &&
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable))) {
    event.preventDefault();
    shellElement.value?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }
}
watch([query, kindFilter, categoryFilter], () => { visibleLimit.value = 24; });
watch([text, phonemes, bank], scheduleAnalysis, { immediate: true });
watch(text, () => {
  stopPlayback(); rendered.value = null; renderMessage.value = ""; opusMessage.value = "";
  if (opusUrl.value) URL.revokeObjectURL(opusUrl.value);
  opusUrl.value = "";
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = "";
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
  analysisRevision += 1;
  analysisController?.abort();
  analysisController = null;
  renderController?.abort(); previewController?.abort(); stopPlayback();
  void audioContext?.close();
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
        <section class="page-heading">
          <div><p>本地音频工作室</p><h1>公告编辑器</h1><p>组合语音素材与游戏修饰符，预览并导出公告音频。</p></div>
          <div class="engine-status" role="status"><strong>{{ loading ? "正在初始化" : bank ? "ENGINE READY" : "引擎离线" }}</strong><span>{{ bank ? `${bank.clips.length.toLocaleString()} 个素材` : loading ? "正在加载本地素材" : "检查素材后重试" }}</span></div>
        </section>
        <FluentNotice v-if="loading">正在准备本地语音素材库…</FluentNotice>
        <FluentNotice v-else-if="loadError" tone="danger">{{ loadError }} <FluentButton tone="secondary" @click="reloadApp">重试</FluentButton></FluentNotice>
        <div class="studio-grid">
          <section class="main-column" aria-label="公告编辑">
            <section class="panel">
              <div class="panel-heading"><div><h2>公告内容</h2><p>输入文本，或使用工具栏插入游戏修饰符与素材。</p></div><span>{{ text.length }} 字符</span></div>
              <div class="authoring-tools">
                <div class="tool-group"><strong>边界提示</strong>
                  <FluentButton tone="secondary" :disabled="!selectedStartCue || !bank || rendering || encodingOpus" :title="selectedStartCue ? `插入开始提示素材 ${selectedStartCue}` : '请先在素材目录中选择开始提示素材'" @click="insertCue('start')">插入开始提示</FluentButton>
                  <FluentButton tone="secondary" :disabled="!selectedEndCue || !bank || rendering || encodingOpus" :title="selectedEndCue ? `插入结束提示素材 ${selectedEndCue}` : '请先在素材目录中选择结束提示素材'" @click="insertCue('end')">插入结束提示</FluentButton>
                </div>
                <p class="cue-selection">所选素材：开始 <code>{{ selectedStartCueLabel }}</code> · 结束 <code>{{ selectedEndCueLabel }}</code></p>
                <div class="tool-group"><strong>游戏修饰符</strong>
                  <FluentButton v-for="command in ['$SLEEP_0.5', '$STUTT_0.1_0.1_3', '$PITCH_1.1', '$VOL_0.8']" :key="command" tone="secondary" :disabled="!bank || rendering || encodingOpus" @click="insertText(command)">{{ command }}</FluentButton>
                </div>
                <div class="tool-group"><strong>音素输入</strong><FluentButton tone="secondary" :disabled="!bank || rendering || encodingOpus" @click="insertText('/ a e: /')">插入音素</FluentButton></div>
                <p class="help-text">斜线间的内容会按音素片段拼接，音质仍属实验性。便捷输入 <code>a</code> 映射到库存的 <code>ɑː</code>，<code>e</code> 映射到 <code>ɛ</code>，冒号表示长音（<code>e:</code> 会延长 <code>ɛ</code>）。默认没有已确认的游戏边界提示，可在素材目录为任意可用素材设定开始或结束提示。修饰符会作用于后续语音片段；素材可用 <code>$CLIP_id</code> 明确引用。</p>
              </div>
              <div class="phrase-field"><FluentField v-model="text" label="公告内容" multiline :disabled="!bank || rendering || encodingOpus" placeholder="输入公告内容…" /></div>
              <div class="token-summary"><strong>识别到的语音：{{ analysis.words.length }}</strong><div v-if="analysis.words.length" class="word-chips"><span v-for="(word, index) in analysis.words.slice(0, 14)" :key="`${word}-${index}`">{{ word }}</span><span v-if="analysis.words.length > 14">+{{ analysis.words.length - 14 }}</span></div><span v-else>输入文本后显示匹配情况</span><div v-if="analysis.ipa.length" class="ipa-summary"><strong>音素片段</strong><span>{{ analysis.ipa.join(' · ') }}</span></div></div>
              <FluentNotice v-if="analysis.warnings.length" tone="warning">{{ analysis.warnings[0] }}<span v-if="analysis.warnings.length > 1">（另有 {{ analysis.warnings.length - 1 }} 条提示）</span></FluentNotice>
            </section>
            <section class="panel">
              <div class="panel-heading"><div><h2>素材目录</h2><p>目录标明素材可用状态与素材用途；可插入片段或单独试听。</p></div><span>{{ bank?.clips.length ?? 0 }} 个素材</span></div>
              <div class="library-toolbar">
                <FluentField v-model="query" type="search" label="搜索素材" placeholder="搜索名称、分类或文件名" />
                <FluentSelect v-model="categoryFilter" label="分类" :options="categoryOptions" />
                <div class="filter-tabs" role="group" aria-label="素材类型">
                  <FluentToggleButton v-for="option in kindOptions" :key="option.value" :model-value="kindFilter === option.value" @update:model-value="(active) => active && (kindFilter = option.value)">{{ option.label }}</FluentToggleButton>
                </div>
              </div>
              <p class="available-note">状态：素材文件已随本地语音库提供</p>
              <div v-if="visibleClips.length" class="clip-list" aria-label="可用语音素材">
                <article v-for="clip in visibleClips" :key="clip.id" class="clip-row">
                  <div class="clip-info"><strong>{{ getClipUsage(clip).label }}</strong><code>{{ clip.id }}</code><span>{{ getClipUsage(clip).category }} · {{ clip.kind === "effect" ? "内部效果片段" : "语音片段" }} · {{ clip.duration.toFixed(1) }}s</span></div>
                  <div class="clip-actions">
                    <FluentButton tone="subtle" :disabled="Boolean(previewing) || rendering || encodingOpus" :busy="previewing === clip.id" :aria-label="`试听 ${clip.id}`" @click="previewClip(clip)">{{ previewing === clip.id ? "正在试听" : "试听" }}</FluentButton>
                    <FluentButton tone="secondary" :disabled="!bank || rendering || encodingOpus" :title="getClipUsage(clip).description" @click="insertClip(clip)">插入</FluentButton>
                    <FluentButton tone="subtle" :disabled="selectedStartCue === clip.id" :aria-label="`将 ${clip.id} 设为开始提示`" @click="setCue('start', clip)">{{ selectedStartCue === clip.id ? "开始提示已选" : "设为开始" }}</FluentButton>
                    <FluentButton tone="subtle" :disabled="selectedEndCue === clip.id" :aria-label="`将 ${clip.id} 设为结束提示`" @click="setCue('end', clip)">{{ selectedEndCue === clip.id ? "结束提示已选" : "设为结束" }}</FluentButton>
                  </div>
                </article>
              </div>
              <FluentNotice v-else tone="info">没有符合条件的素材，请调整搜索词或筛选条件。</FluentNotice>
              <FluentButton v-if="visibleClips.length < matchingClips.length" class="show-more" tone="subtle" @click="visibleLimit += 24">加载更多（剩余 {{ matchingClips.length - visibleClips.length }} 个）</FluentButton>
            </section>
          </section>
          <aside class="side-column" aria-label="渲染设置">
            <section class="panel">
              <div class="panel-heading"><div><h2>声音设置</h2><p>调整本次公告的全局混音。</p></div></div>
              <div class="settings">
                <label><span>音高 <b>{{ pitch.toFixed(2) }}×</b></span><FluentSlider v-model="pitch" :min="0.65" :max="1.35" :step="0.01" aria-label="音高" /></label>
                <label><span>音量 <b>{{ Math.round(volume * 100) }}%</b></span><FluentSlider v-model="volume" :min="0.1" :max="1" :step="0.01" aria-label="音量" /></label>
                <label><span>词间间隔 <b>{{ gap.toFixed(2) }}s</b></span><FluentSlider v-model="gap" :min="0" :max="0.8" :step="0.01" aria-label="词间间隔" /></label>
                <div class="ambient-row"><span>环境底噪<small>加入轻微设施环境声</small></span><FluentSwitch v-model="background" aria-label="环境底噪" /></div>
                <div class="phoneme-setting"><span>实验音素拼合<small>尝试拼合未收录的英语词</small></span><FluentSwitch v-model="phonemes" aria-label="实验音素拼合" /></div>
                <div class="phone-inventory"><strong>已测量可用音素（{{ phoneKeys.length }}）</strong><span v-if="phoneIndexError">{{ phoneIndexError }}</span><div v-else class="phone-list"><FluentButton v-for="phone in phoneKeys" :key="phone" tone="subtle" :aria-label="`插入音素 ${phone}`" :title="`插入 / ${phone} /`" @click="insertText(`/ ${phone} /`)">{{ phone }}</FluentButton></div></div>
              </div>
            </section>
            <section class="panel output-panel">
              <div class="panel-heading"><div><h2>渲染与导出</h2><p>音频在本机生成，不会上传文本。</p></div></div>
              <div v-if="rendering || encodingOpus" class="render-progress"><FluentProgressBar :value="progress" :max="100" :label="rendering ? '正在渲染公告音频' : '正在编码 Opus'" /><span>{{ rendering ? "正在渲染" : "正在编码" }} · {{ Math.round(progress) }}%</span></div>
              <FluentNotice v-if="renderMessage" :tone="rendered ? 'success' : renderMessage.includes('取消') ? 'info' : 'danger'">{{ renderMessage }}</FluentNotice>
              <FluentNotice v-if="opusMessage" :tone="opusUrl ? 'success' : opusMessage.includes('取消') ? 'info' : 'danger'">{{ opusMessage }}</FluentNotice>
              <FluentNotice v-if="allWarnings.length" tone="warning"><strong>渲染提示</strong><span v-for="warning in allWarnings.slice(0, 4)" :key="warning" class="warning-item">{{ warning }}</span></FluentNotice>
              <FluentNotice v-if="audioError" tone="danger">{{ audioError }}</FluentNotice>
              <div class="output-actions">
                <FluentButton v-if="rendering || encodingOpus" tone="danger" @click="cancelRender">取消任务</FluentButton>
                <FluentButton v-else tone="primary" :disabled="!bank || !text.trim()" :busy="rendering" @click="compose">生成公告音频</FluentButton>
                <template v-if="rendered">
                  <FluentButton tone="secondary" :disabled="playing" @click="preview">{{ playing ? "正在播放" : "试听成品" }}</FluentButton>
                  <FluentButton v-if="playing" tone="subtle" @click="stopPlayback">停止播放</FluentButton>
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
