import { ref, watch } from 'vue';
import { createI18n } from 'vue-i18n';

const messages = {
  en: {
    appTitle: "Announcement editor", source: "Source code", lang: "Language",
    loadingBank: "Preparing the local voice library…", urlStateInvalid: "Invalid announcement URL data. No automatic export was started.", retry: "Retry",
    bankLoadError: "Could not load the voice library", phonemeIndexError: "Could not load the phoneme index",
    ribbonAria: "Ribbon", ribbonCollapse: "Collapse the ribbon (Ctrl+F1)", ribbonExpand: "Show the ribbon (Ctrl+F1)", ribbonScrollLeft: "Scroll the ribbon left", ribbonScrollRight: "Scroll the ribbon right",
    group: { render: "Render", export: "Export", markers: "Markers", effects: "Effects", timing: "Timing", reading: "Reading time", advanced: "Advanced", mix: "Global mix", processing: "Voice processing" },
    cmd: { render: "Render" },
    tip: {
      render: "Render the announcement now (Ctrl/Cmd+Enter)",
      sync: "Wrap the selection in a temporary parallel track, for harmony or echoes",
      fit: "Wrap the selection in a tag that stretches its speech to take exactly this many seconds",
      wav: "Download the rendered announcement as WAV", opus: "Encode the rendered announcement as Opus and download it",
      loudness: "Adjusts speech loudness from −24 to +12 dB, limited by peak headroom.", tension: "Softens (−1) or brightens (+1) voiced tone with spectral tilt.",
    },
    cancel: "Cancel task", liveRender: "Live render", liveHelp: "Updates audio without playing it automatically",
    unrecordedWords: "Unrecorded words", unrecordedHelp: "On: synthesize unrecorded words from phonemes. Off: strict mode, only recorded words are spoken.",
    start: "Start", end: "End", pause: "Pause", clip: "Clip", stutter: "Stutter", pitch: "Game pitch", volume: "Volume", rate: "Speech rate", offset: "Offset", duration: "Duration", spacing: "Spacing", voice: "Voice scope",
    sync: "Sync", wordGap: "Word gap", voicePitch: "Pitch shift (semitones)", loudness: "Loudness (dB)", tension: "Tension", breathiness: "Breathiness", formant: "Formant shift (semitones)",
    fitSeconds: "Seconds", fit: "Fit to time", wavShort: "WAV", opusShort: "Opus", ribbonToggle: "Ribbon", outline: "Outline", phonemeList: "Phonemes", help: "Help",
    activityAria: "Side bar views", outlineEmpty: "No tags detected yet.", lineShort: "Ln {line}",
    inventory: "Available phonemes ({count})", insertPhone: "Insert phoneme {phone}", phoneTitle: "Insert / {phone} /",
    rateHelp: "Changes spoken clip speed, not word gaps, pauses, or cues.",
    voiceHelp: "Uses the browser's WORLD DSP. Neutral values preserve original recordings. These controls affect speech only; they do not move cues or pauses. Speech rate remains independently adjustable.",
    intro: "Type English words directly, or enter voice tags and / phonemes /.", inlineExample: "Inline example:", markupReference: "Markup reference",
    wholeWord: "Whole-word effect:", markupStutter: "Stutter:", repeatHelp: "Stutter repeats the source fragment this many extra times.",
    cursorHelp: "You can place tags inside a word; insertion adds no spaces. Select text to wrap it in an effect, or insert at the cursor to select the placeholder word. You can also type closing tags yourself.", wordPlaceholder: "word",
    standaloneHelp: "Standalone tags may end with a slash or omit it:", andWord: "and", equivalent: "are equivalent.", brHelp: " pauses for 0.5 seconds.", brAlsoPauses: " also pauses for 0.5 seconds.",
    pauseHelp: "Pause:", orWord: "or", listSeparator: ";", clipHelp: "Clip:", comma: ",", replaceClipId: "Replace the ID with an asset ID.",
    phonemeHelp: "Direct phonemes:", caseHelp: "Recorded English is matched without regard to case. Unrecorded ALL-CAPS words are spoken as letter names. In the example, uppercase A is a letter name, lowercase a is the article, and standalone I is the pronoun.",
    rateExample: "Rate example:", fitExample: "Reading time:", fitHelp: "Stretches or squeezes the enclosed speech so it takes exactly this many seconds. It is the inverse of speed: you set the duration, not the factor.",
    markupVolume: "Volume:", markupTiming: "Timing and spacing:", voiceExample: "Voice scope:", voiceTagHelp: "Only enclosed speech uses these values; the closing tag restores prior settings.", fullStop: ".",
    syncExample: "Parallel track:", syncHelp: "Content inside plays on its own temporary track starting where the next word would start, so voices can harmonize or echo. The longest track sets the length. Tracks can nest.",
    strictHelp: "Strict mode (Unrecorded words off): only recorded words are spoken; synthesizable words are skipped and shown with a dashed underline.",
    legend: "Colour legend", legendEditor: "Editor text", legendTimeline: "Player timeline", legendWavy: "Wavy underline: has a suggested fix", legendDashed: "Dashed underline: blocked by strict mode",
    legendCue: "Cues and effects", legendGap: "Gap (transparent)", legendSyncLane: "Thin lanes below: sync tracks",
    shortcuts: "Shortcuts", shortcutFocus: "Focus the editor", shortcutRender: "Render the announcement", shortcutSideBar: "Toggle the side bar", about: "About", localAudio: "Audio is generated on this device; text is not uploaded.", sourceFooter: "Source code", licenses: "AGPL-3.0 and third-party licenses",
    editorRegion: "Announcement editor", editorTabsAria: "Open editors", editorAria: "Announcement text", editorPlaceholder: "Enter announcement text…",
    recorded: "Recorded audio", synthesized: "Synthesized audio", blockedWord: "Synthesizable, skipped in strict mode", recognizedCommand: "Recognized command", cannotSynthesize: "Cannot synthesize",
    ordinaryText: "Plain text", gapLabel: "Gap", dictionaryMissing: "Not in dictionary; synthesis will still be attempted", fixSuggestion: "Suggested fix: {text}", fixRemove: "Suggested fix: remove it",
    panelAria: "Panel", panelClose: "Hide panel", panelOpen: "Show panel", panelPlayer: "Player", analysis: "Analysis", noProblems: "No problems detected.", analysisEmpty: "Nothing to analyze yet.",
    detectedPieces: "Detected {count} speech segments", severityFilter: "Filter by severity", severity: { error: "Errors", warning: "Warnings", info: "Info" },
    statusError: "Error", statusLoading: "Loading", statusEncoding: "Encoding", statusRendering: "Rendering", ready: "Ready", cursorPosition: "Ln {line}, Col {column}", renderedDuration: "Duration", characters: "characters",
    renderCancelled: "Render cancelled", renderFailed: "Audio render failed", loadingOpus: "Loading Opus encoder…", opusReady: "Opus file ready", opusCancelled: "Encoding cancelled", opusFailed: "Opus encoding failed",
    player: { play: "Play", pause: "Pause", seek: "Playback position", generate: "Generate audio", cancel: "Cancel render", rendering: "Rendering audio", audioPlayer: "Announcement audio player", timeline: "Rendered audio timeline" },
  },
  zh: {
    appTitle: "公告编辑器", source: "项目源码", lang: "语言",
    loadingBank: "正在准备本地语音素材库…", urlStateInvalid: "URL 公告数据无效，未启动自动导出。", retry: "重试",
    bankLoadError: "语音素材库无法加载", phonemeIndexError: "无法加载音素索引",
    ribbonAria: "功能区", ribbonCollapse: "折叠功能区 (Ctrl+F1)", ribbonExpand: "显示功能区 (Ctrl+F1)", ribbonScrollLeft: "向左滚动功能区", ribbonScrollRight: "向右滚动功能区",
    group: { render: "渲染", export: "导出", markers: "标记", effects: "效果", timing: "时序", reading: "朗读时长", advanced: "高级", mix: "全局混音", processing: "语音后处理" },
    cmd: { render: "渲染" },
    tip: {
      render: "立即渲染公告（Ctrl/Cmd+Enter）",
      sync: "把选区包进临时并行音轨，用于和声或附和",
      fit: "把选区包进标签，使其语音恰好持续指定秒数",
      wav: "把已渲染的公告下载为 WAV", opus: "把已渲染的公告编码为 Opus 并下载",
      loudness: "调节语音响度，范围 −24 至 +12 dB；增益受峰值余量限制。", tension: "通过频谱倾斜让有声段更柔和（−1）或更明亮（+1）。",
    },
    cancel: "取消任务", liveRender: "实时渲染", liveHelp: "更新音频但不自动播放",
    unrecordedWords: "未收录词", unrecordedHelp: "开启：用音素合成未收录的词；关闭：严格模式，只朗读已录制的词。",
    start: "开始", end: "结束", pause: "停顿", clip: "素材片段", stutter: "卡顿", pitch: "游戏音高", volume: "音量", rate: "语速", offset: "偏移", duration: "时长", spacing: "间隔", voice: "语音作用范围",
    sync: "同步", wordGap: "词间间隔", voicePitch: "音调偏移（半音）", loudness: "响度（dB）", tension: "张力", breathiness: "气声", formant: "共振峰偏移（半音）",
    fitSeconds: "秒数", fit: "限定时长", wavShort: "WAV", opusShort: "Opus", ribbonToggle: "功能区", outline: "大纲", phonemeList: "音素", help: "帮助",
    activityAria: "侧栏视图", outlineEmpty: "尚未检测到标签。", lineShort: "第 {line} 行",
    inventory: "可用音素（{count}）", insertPhone: "插入音素 {phone}", phoneTitle: "插入 / {phone} /",
    rateHelp: "只改变语音片段语速，不影响词间隔、停顿或提示音。",
    voiceHelp: "使用浏览器内的 WORLD DSP。中性值保留原始录音。控制项只影响语音，不改变提示音或停顿；语速可单独调整。",
    intro: "直接输入英文单词，也可手敲语音标签或 / 音素 /。", inlineExample: "词内效果示例：", markupReference: "标记参考",
    wholeWord: "整词效果：", markupStutter: "卡顿：", repeatHelp: "卡顿的 repeats 表示原始片段之后额外重复的次数。",
    cursorHelp: "可把标签放在词中，插入时不会添加空格。选择文字后，效果按钮会包住选区；在光标处插入时会选中占位单词。也可手动输入闭合标签。", wordPlaceholder: "word",
    standaloneHelp: "独立标记可自闭或省略尾斜线：", andWord: "与", equivalent: "等效。", brHelp: " 会停顿 0.5 秒。", brAlsoPauses: "也会停顿 0.5 秒。",
    pauseHelp: "停顿：", orWord: "或", listSeparator: "；", clipHelp: "素材：", comma: "，", replaceClipId: "将 ID 换成素材 ID。",
    phonemeHelp: "直接音素：", caseHelp: "已收录英文按大小写不敏感匹配；未收录的全大写词按英文字母名朗读。示例里的大写 A 是字母名，小写 a 是冠词，单独的 I 是代词。",
    rateExample: "语速示例：", fitExample: "朗读时长：", fitHelp: "拉伸或压缩标签内的语音，使其恰好持续指定秒数。这是倍速的逆向参数：指定的是时长，而不是倍率。",
    markupVolume: "音量：", markupTiming: "时序与间隔：", voiceExample: "语音作用范围示例：", voiceTagHelp: "只有标签内部的语音使用这些设置；闭合标签会恢复之前的值。", fullStop: "。",
    syncExample: "并行音轨：", syncHelp: "标签内的内容在独立的临时音轨上播放，从下一个词本应开始的位置（含正常词间隔）开始，可做和声或附和；总时长取最长的音轨；可嵌套。",
    strictHelp: "严格模式（关闭未收录词）：只朗读已录制的词；可合成的词被跳过，以虚线下划线标出。",
    legend: "颜色图例", legendEditor: "编辑器文本", legendTimeline: "播放器时间轴", legendWavy: "波浪下划线：有修复建议", legendDashed: "虚线下划线：被严格模式阻止",
    legendCue: "提示音与效果", legendGap: "间隔（透明）", legendSyncLane: "下方细车道：同步音轨",
    shortcuts: "快捷键", shortcutFocus: "聚焦编辑器", shortcutRender: "渲染公告", shortcutSideBar: "切换侧栏", about: "关于", localAudio: "音频在本机生成，不会上传文本。", sourceFooter: "源代码", licenses: "AGPL-3.0 与第三方许可",
    editorRegion: "公告编辑", editorTabsAria: "已打开的编辑器", editorAria: "公告内容", editorPlaceholder: "输入公告内容…",
    recorded: "原始录音", synthesized: "合成音频", blockedWord: "可合成，严格模式下已跳过", recognizedCommand: "识别命令", cannotSynthesize: "无法合成",
    ordinaryText: "普通文本", gapLabel: "间隔", dictionaryMissing: "词典未收录，仍可合成", fixSuggestion: "建议修复：{text}", fixRemove: "建议修复：删除",
    panelAria: "面板", panelClose: "隐藏面板", panelOpen: "显示面板", panelPlayer: "播放器", analysis: "分析", noProblems: "未发现问题。", analysisEmpty: "暂无可分析的内容。",
    detectedPieces: "识别到 {count} 个语音片段", severityFilter: "按严重程度筛选", severity: { error: "错误", warning: "警告", info: "信息" },
    statusError: "错误", statusLoading: "加载中", statusEncoding: "编码中", statusRendering: "渲染中", ready: "就绪", cursorPosition: "行 {line}，列 {column}", renderedDuration: "时长", characters: "字符",
    renderCancelled: "渲染已取消", renderFailed: "音频渲染失败", loadingOpus: "正在加载 Opus 编码器…", opusReady: "Opus 文件已就绪", opusCancelled: "编码已取消", opusFailed: "Opus 编码失败",
    player: { play: "播放", pause: "暂停", seek: "播放位置", generate: "生成音频", cancel: "取消渲染", rendering: "正在渲染音频", audioPlayer: "公告音频播放器", timeline: "已渲染音频时间轴" },
  },
} as const;

function initialLocale(): 'en' | 'zh' {
  try {
    const saved = localStorage.getItem('cassie-locale');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* storage may be unavailable */ }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export const locale = ref<'en' | 'zh'>(initialLocale());
export const i18n = createI18n({ legacy: false, locale: locale.value, fallbackLocale: 'en', messages });
export function t(key: string, values?: Record<string, string | number>): string {
  return String(i18n.global.t(key as never, values as never));
}
export function setLocale(value: 'en' | 'zh') { locale.value = value; }

watch(locale, (value) => {
  i18n.global.locale.value = value;
  document.title = 'CASSIE PLUS · ' + t('appTitle');
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
  try { localStorage.setItem('cassie-locale', value); } catch { /* storage may be unavailable */ }
}, { immediate: true });
