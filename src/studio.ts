import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch, type InjectionKey } from "vue";
import { locale, setLocale, t } from "./i18n";
import { analyzeAnnouncement, encodeWav, loadBank, renderAnnouncement, type AnalysisToken as EngineAnalysisToken, type TimelineEntry } from "./audio/engine";
import { checkEnglishSpelling } from "./spelling";
import { DEFAULT_ANNOUNCEMENT } from "./defaultAnnouncement";
import { boundedNumber, phonemeInsertion } from "./editor";
import { FIT_RANGE, MARKERS, SCOPES, fitScope, type MarkerName, type ScopeName, type SettingId } from "./markup";
import type { ActionId } from "./ribbon";
import type { DecodedUrlState } from "./url-state";

export const SIDE_VIEWS = ["outline", "phonemes", "settings", "help"] as const;
export const PANEL_TABS = ["player", "problems", "analysis", "export"] as const;
export type SideView = (typeof SIDE_VIEWS)[number];
export type PanelTab = (typeof PANEL_TABS)[number];

type Bank = Awaited<ReturnType<typeof loadBank>>;
export type AnalysisToken = EngineAnalysisToken & { spellingMissing?: boolean };
type RenderedAnnouncement = Omit<Awaited<ReturnType<typeof renderAnnouncement>>, "samples"> & { samples: Float32Array<ArrayBuffer>; timeline: TimelineEntry[] };

const statusMessageKeys = new Set(["renderCancelled", "opusCancelled", "opusReady", "loadingOpus", "renderFailed", "opusFailed"]);
const COMPACT_QUERY = "(max-width: 819px)";

export function createStudio(props: { initialState?: DecodedUrlState | null; urlError?: boolean }) {
  const initialOptions = props.initialState?.options;
  const compactQuery = window.matchMedia(COMPACT_QUERY);

  const bank = shallowRef<Bank | null>(null);
  const loading = ref(true);
  const loadError = ref("");
  const text = ref(props.initialState?.text ?? DEFAULT_ANNOUNCEMENT);
  const pitch = ref(initialOptions?.pitch ?? 1);
  const volume = ref(initialOptions?.volume ?? 1);
  const gap = ref(initialOptions?.gap ?? 0.24);
  const rate = ref(initialOptions?.rate ?? 1);
  const voicePitch = ref(initialOptions?.voice.pitchSemitones ?? 0);
  const breathiness = ref(initialOptions?.voice.breathiness ?? 0);
  const formant = ref(initialOptions?.voice.formantSemitones ?? 0);
  const loudness = ref(initialOptions?.voice.loudnessDb ?? 0);
  const tension = ref(initialOptions?.voice.tension ?? 0);
  const fitSeconds = ref<number>(FIT_RANGE.default);
  const liveRender = ref(true);

  const compact = ref(compactQuery.matches);
  const sideBarOpen = ref(!compact.value);
  const sideView = ref<SideView>("outline");
  const panelOpen = ref(true);
  const panelTab = ref<PanelTab>("player");
  const ribbonTab = ref("home");
  const ribbonCollapsed = ref(false);

  const progress = ref(0);
  const rendering = ref(false);
  const renderMessage = ref("");
  const rendered = shallowRef<RenderedAnnouncement | null>(null);
  const previewResult = shallowRef<RenderedAnnouncement | null>(null);
  const encodingOpus = ref(false);
  const opusMessage = ref("");
  const opusUrl = ref("");
  const downloadUrl = ref("");
  const previewUrl = ref("");
  const phoneKeys = ref<string[]>([]);
  const phoneIndexError = ref("");
  const analysis = shallowRef<{ words: string[]; warnings: string[]; ipa: string[]; tokens: AnalysisToken[] }>({ words: [], warnings: [], ipa: [], tokens: [] });
  const audioTime = ref(0);
  const cursor = ref({ line: 1, column: 1 });
  const editorEl = shallowRef<HTMLTextAreaElement | null>(null);
  const player = shallowRef<{ stopPlayback: () => void } | null>(null);

  let initialExportPending = Boolean(props.initialState?.export);
  let renderController: AbortController | null = null;
  let analysisRevision = 0;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let analysisController: AbortController | null = null;
  let liveRenderTimer: ReturnType<typeof setTimeout> | undefined;

  const allWarnings = computed(() => [...new Set([...analysis.value.warnings, ...(rendered.value?.warnings ?? [])])]);
  const playbackResult = computed(() => rendered.value ?? previewResult.value);
  const playbackUrl = computed(() => rendered.value ? downloadUrl.value || undefined : previewUrl.value || undefined);
  const playbackDuration = computed(() => playbackResult.value?.duration ?? 0);
  const hasText = computed(() => Boolean(text.value.trim()) && Boolean(bank.value));
  const busy = computed(() => rendering.value || encodingOpus.value);
  const activeTimelineItem = computed(() => playbackResult.value?.timeline?.find((item) => audioTime.value >= item.startSeconds && audioTime.value < item.endSeconds) ?? null);

  function statusText(message: string) { return statusMessageKeys.has(message) ? t(message) : message; }
  function toggleLocale() { setLocale(locale.value === "zh" ? "en" : "zh"); }

  function syncCursor() {
    const field = editorEl.value;
    const offset = field?.selectionStart ?? 0;
    const before = text.value.slice(0, offset);
    const line = before.split("\n").length;
    cursor.value = { line, column: offset - before.lastIndexOf("\n") };
  }
  function goToOffset(offset: number) {
    const field = editorEl.value;
    if (!field) return;
    field.focus();
    field.setSelectionRange(offset, offset);
    const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 20;
    const top = (text.value.slice(0, offset).split("\n").length - 1) * lineHeight;
    if (top < field.scrollTop || top > field.scrollTop + field.clientHeight - lineHeight * 2) field.scrollTop = Math.max(0, top - field.clientHeight / 3);
    syncCursor();
    if (compact.value) sideBarOpen.value = false;
  }

  function applyEdit(expected: string, caret: { start: number; end: number }) {
    const field = editorEl.value;
    text.value = expected;
    void nextTick(() => {
      if (text.value !== expected || field?.value !== expected) return;
      field?.focus();
      field?.setSelectionRange(caret.start, caret.end);
      syncCursor();
    });
  }
  function selectionRange() {
    const field = editorEl.value;
    const start = field?.selectionStart ?? text.value.length;
    return { start, end: field?.selectionEnd ?? start };
  }
  function insertMarker(value: string) {
    const { start, end } = selectionRange();
    const expected = text.value.slice(0, start) + value + text.value.slice(start, end) + text.value.slice(end);
    applyEdit(expected, { start: start + value.length, end: start + value.length });
  }
  function insertPhoneme(phone: string) {
    const { start, end } = selectionRange();
    const range = phonemeInsertion(text.value, start, end, phone);
    applyEdit(text.value.slice(0, start) + range.value + text.value.slice(end), { start: start + range.selectionStart, end: start + range.selectionEnd });
  }
  function insertScope(open: string, close: string, placeholder = "word") {
    const { start, end } = selectionRange();
    const body = text.value.slice(start, end) || placeholder;
    applyEdit(text.value.slice(0, start) + open + body + close + text.value.slice(end), { start: start + open.length, end: start + open.length + body.length });
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
        if (!controller.signal.aborted && revision === analysisRevision) analysis.value = { words: [], warnings: [error instanceof Error ? error.message : "Could not analyze announcement."], ipa: [], tokens: [] };
      } finally {
        if (analysisController === controller) analysisController = null;
      }
    }, 120);
  }

  function stopPlayback() { player.value?.stopPlayback(); }
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
          voice: { pitchSemitones: voicePitch.value, breathiness: breathiness.value, formantSemitones: formant.value, loudnessDb: loudness.value, tension: tension.value } },
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
  function saveUrl(url: string, extension: "wav" | "opus") {
    const link = document.createElement("a");
    link.href = url;
    link.download = `cassie-announcement.${extension}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  }
  function inputSignature() {
    return JSON.stringify([text.value, pitch.value, volume.value, gap.value, rate.value, voicePitch.value, loudness.value, tension.value, breathiness.value, formant.value]);
  }
  async function exportInitialAnnouncement() {
    const format = props.initialState?.export;
    if (!format || !bank.value) { initialExportPending = false; return; }
    const signature = inputSignature();
    try {
      await compose();
      if (!rendered.value || signature !== inputSignature()) return;
      if (format === "opus") await exportOpus();
      if (!rendered.value || signature !== inputSignature()) return;
      const url = format === "opus" ? opusUrl.value : downloadUrl.value;
      if (url) saveUrl(url, format);
    } finally {
      initialExportPending = false;
      if (signature !== inputSignature() && liveRender.value && bank.value && text.value.trim() && !rendering.value && !encodingOpus.value) {
        liveRenderTimer = setTimeout(() => void compose(), 500);
      }
    }
  }

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

  function showPanel(tab: PanelTab) { panelTab.value = tab; panelOpen.value = true; }
  function showSideView(view: SideView) {
    if (sideBarOpen.value && sideView.value === view) sideBarOpen.value = false;
    else { sideView.value = view; sideBarOpen.value = true; }
  }
  function focusSetting(id: SettingId) {
    sideView.value = "settings";
    sideBarOpen.value = true;
    void nextTick(() => document.querySelector<HTMLElement>(`[data-setting="${id}"] input`)?.focus());
  }
  function focusEditor() { editorEl.value?.focus(); }

  const actions: Record<ActionId, () => void> = {
    render: () => void compose(),
    cancel: cancelRender,
    toggleLive: () => { liveRender.value = !liveRender.value; },
    exportWav: () => { if (downloadUrl.value) saveUrl(downloadUrl.value, "wav"); showPanel("export"); },
    exportOpus: () => { showPanel("export"); if (opusUrl.value) saveUrl(opusUrl.value, "opus"); else void exportOpus(); },
    toggleSideBar: () => { sideBarOpen.value = !sideBarOpen.value; },
    togglePanel: () => { panelOpen.value = !panelOpen.value; },
    toggleRibbon: () => { ribbonCollapsed.value = !ribbonCollapsed.value; },
    insertPhonemes: () => insertPhoneme("a e:"),
    "scope.fit": () => {
      const seconds = boundedNumber(fitSeconds.value, FIT_RANGE.min, FIT_RANGE.max) ?? FIT_RANGE.default;
      fitSeconds.value = seconds;
      const scope = fitScope(seconds);
      insertScope(scope.open, scope.close);
    },
    ...Object.fromEntries((Object.keys(MARKERS) as MarkerName[]).map((name) => [`marker.${name}`, () => insertMarker(MARKERS[name])])),
    ...Object.fromEntries((Object.keys(SCOPES) as ScopeName[]).map((name) => [`scope.${name}`, () => insertScope(SCOPES[name].open, SCOPES[name].close)])),
    ...Object.fromEntries(SIDE_VIEWS.map((view) => [`view.${view}`, () => { sideView.value = view; sideBarOpen.value = true; }])),
    ...Object.fromEntries((["pitch", "volume", "gap", "rate", "voicePitch", "loudness", "tension", "breathiness", "formant"] as SettingId[]).map((id) => [`setting.${id}`, () => focusSetting(id)])),
  } as Record<ActionId, () => void>;
  function run(action: ActionId) { actions[action](); }

  function onGlobalKeydown(event: KeyboardEvent) {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    if (event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey && !typing) {
      event.preventDefault();
      focusEditor();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault();
      void compose();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      sideBarOpen.value = !sideBarOpen.value;
    }
  }
  function onCompactChange(event: MediaQueryListEvent) {
    compact.value = event.matches;
    sideBarOpen.value = !event.matches;
  }

  watch([text, bank], scheduleAnalysis, { immediate: true });
  watch([text, pitch, volume, gap, rate, voicePitch, breathiness, formant, loudness, tension, bank], () => {
    invalidateRendered();
    if (renderController) cancelRender();
    if (initialExportPending || !liveRender.value || !bank.value || !text.value.trim()) return;
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
    compactQuery.addEventListener("change", onCompactChange);
    void fetch("/phonemes.json").then(async (response) => {
      if (!response.ok) throw new Error(t("phonemeIndexError"));
      const data = await response.json() as { phones?: Record<string, unknown> };
      phoneKeys.value = Object.keys(data.phones ?? {}).sort((left, right) => left.localeCompare(right));
    }).catch((error) => { phoneIndexError.value = error instanceof Error ? error.message : t("phonemeIndexError"); });
    try { bank.value = await loadBank(); }
    catch (error) { loadError.value = error instanceof Error ? error.message : t("bankLoadError"); }
    finally { loading.value = false; }
    if (initialExportPending) {
      await nextTick();
      if (liveRenderTimer) clearTimeout(liveRenderTimer);
      await exportInitialAnnouncement();
    }
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onGlobalKeydown);
    compactQuery.removeEventListener("change", onCompactChange);
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

  return reactive({
    urlError: Boolean(props.urlError),
    bank, loading, loadError, text, pitch, volume, gap, rate, voicePitch, loudness, tension, breathiness, formant, fitSeconds, liveRender,
    compact, sideBarOpen, sideView, panelOpen, panelTab, ribbonTab, ribbonCollapsed,
    progress, rendering, renderMessage, rendered, encodingOpus, opusMessage, opusUrl, downloadUrl,
    phoneKeys, phoneIndexError, analysis, audioTime, cursor, editorEl, player,
    allWarnings, playbackResult, playbackUrl, playbackDuration, hasText, busy, activeTimelineItem,
    statusText, toggleLocale, syncCursor, goToOffset, insertPhoneme, compose, cancelRender, exportOpus,
    showPanel, showSideView, run,
  });
}

export type Studio = ReturnType<typeof createStudio>;
const studioKey: InjectionKey<Studio> = Symbol("studio");
export function provideStudio(studio: Studio) { provide(studioKey, studio); }
export function useStudio(): Studio {
  const studio = inject(studioKey);
  if (!studio) throw new Error("Studio is not provided");
  return studio;
}
