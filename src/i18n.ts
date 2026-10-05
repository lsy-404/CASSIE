import { ref, watch } from 'vue';
import { createI18n } from 'vue-i18n';

const messages = {
  en: {
    appTitle: "Announcement editor", source: "Source code", lang: "Language",
    loadingBank: "Preparing the local voice library…", urlStateInvalid: "Invalid announcement URL data. No automatic export was started.", retry: "Retry",
    bankLoadError: "Could not load the voice library", phonemeIndexError: "Could not load the phoneme index",
    ribbonAria: "Ribbon", ribbonDoubleClick: "Double-click to collapse or expand the ribbon",
    ribbon: { home: "Home", insert: "Insert", voice: "Voice", timing: "Timing", export: "Export", view: "View" },
    group: { render: "Render", markers: "Markers", effects: "Effects", timing: "Timing", voice: "Voice scope", phonemes: "Phonemes", mix: "Global mix", processing: "Voice processing", pauses: "Pauses and offsets", speed: "Speed", reading: "Reading time", download: "Download", layout: "Layout", views: "Side bar views", help: "Help" },
    cmd: { render: "Render" },
    tip: {
      render: "Render the announcement now (Ctrl/Cmd+Enter)", phonemes: "Insert a direct phoneme block at the cursor",
      setting: "Open this control in the settings side bar", fit: "Wrap the selection in a tag that stretches its speech to take exactly this many seconds",
    },
    cancel: "Cancel task", liveRender: "Live render", liveHelp: "Updates audio without playing it automatically",
    start: "Start", end: "End", pause: "Pause", clip: "Clip", stutter: "Stutter", pitch: "Game pitch", volume: "Volume", rate: "Speech rate", offset: "Offset", duration: "Duration", spacing: "Spacing", voice: "Voice scope",
    insertPhonemes: "Insert phonemes", wordGap: "Word gap", voicePitch: "Pitch shift (semitones)", loudness: "Loudness (dB)", tension: "Tension", breathiness: "Breathiness", formant: "Formant shift (semitones)",
    fitSeconds: "Seconds", fit: "Fit to time", wavShort: "WAV", opusShort: "Opus", sideBar: "Side bar", panel: "Panel", ribbonToggle: "Ribbon", outline: "Outline", phonemeList: "Phonemes", settings: "Sound settings", help: "Help",
    activityAria: "Side bar views", outlineEmpty: "No tags detected yet.", lineShort: "Ln {line}",
    inventory: "Available phonemes ({count})", insertPhone: "Insert phoneme {phone}", phoneTitle: "Insert / {phone} /",
    globalMix: "Adjust the global mix for this announcement.", pitchLabel: "Game pitch {value}×", volumeLabel: "Volume {value}%", gapLabelSetting: "Word gap {value}s", rateLabel: "Speech rate {value}×",
    rateHelp: "Changes spoken clip speed, not word gaps, pauses, or cues.",
    voiceProcessing: "Voice post-processing", voiceHelp: "Uses the browser's WORLD DSP. Neutral values preserve original recordings. These controls affect speech only; they do not move cues or pauses. Speech rate remains independently adjustable.",
    voicePitchLabel: "Pitch shift ({value} semitones)", loudnessLabel: "Loudness ({value} dB)", loudnessHelp: "Adjusts speech loudness from −24 to +12 dB, limited by peak headroom.",
    tensionLabel: "Tension ({value})", tensionHelp: "Softens (−1) or brightens (+1) voiced tone with spectral tilt.", breathinessLabel: "Breathiness (non-periodic energy): {value}", formantLabel: "Formant shift ({value} semitones)",
    missingWords: "Unrecorded word synthesis", missingHelp: "Prefer recordings; try phoneme synthesis when unavailable", enabled: "On",
    intro: "Type English words directly, or enter voice tags and / phonemes /.", inlineExample: "Inline example:", markupReference: "Markup reference",
    wholeWord: "Whole-word effect:", markupStutter: "Stutter:", repeatHelp: "Stutter repeats the source fragment this many extra times.",
    cursorHelp: "You can place tags inside a word; insertion adds no spaces. Select text to wrap it in an effect, or insert at the cursor to select the placeholder word. You can also type closing tags yourself.", wordPlaceholder: "word",
    standaloneHelp: "Standalone tags may end with a slash or omit it:", andWord: "and", equivalent: "are equivalent.", brHelp: " pauses for 0.5 seconds.", brAlsoPauses: " also pauses for 0.5 seconds.",
    pauseHelp: "Pause:", orWord: "or", listSeparator: ";", clipHelp: "Clip:", comma: ",", replaceClipId: "Replace the ID with an asset ID.",
    phonemeHelp: "Direct phonemes:", caseHelp: "Recorded English is matched without regard to case. Unrecorded ALL-CAPS words are spoken as letter names. In the example, uppercase A is a letter name, lowercase a is the article, and standalone I is the pronoun.",
    rateExample: "Rate example:", fitExample: "Reading time:", fitHelp: "Stretches or squeezes the enclosed speech so it takes exactly this many seconds. It is the inverse of speed: you set the duration, not the factor.",
    markupVolume: "Volume:", markupTiming: "Timing and spacing:", voiceExample: "Voice scope:", voiceTagHelp: "Only enclosed speech uses these values; the closing tag restores prior settings.", fullStop: ".",
    shortcuts: "Shortcuts", shortcutFocus: "Focus the editor", shortcutRender: "Render the announcement", shortcutSideBar: "Toggle the side bar", about: "About", sourceFooter: "Source code", licenses: "AGPL-3.0 and third-party licenses",
    editorRegion: "Announcement editor", editorTabsAria: "Open editors", editorAria: "Announcement text", editorPlaceholder: "Enter announcement text…", legendAria: "Text annotations",
    recorded: "Recorded audio", synthesized: "Synthesized audio", spellingHint: "Spelling hint (still synthesized)", recognizedCommand: "Recognized command", approximateOrError: "Approximation or error",
    ordinaryText: "Plain text", gapLabel: "Gap", renderError: "Render error", dictionaryMissing: "Not in dictionary; synthesis will still be attempted",
    panelAria: "Panel", panelClose: "Hide panel", panelPlayer: "Player", panelProblems: "Problems", analysis: "Analysis", output: "Export", noProblems: "No problems detected.", analysisEmpty: "Nothing to analyze yet.",
    detectedPieces: "Detected {count} speech segments", phonemes: "Phonemes", localAudio: "Audio is generated on this device; text is not uploaded.", encodingProgress: "Encoding Opus", encoding: "Encoding",
    wav: "Download WAV", exportOpus: "Export Opus", downloadOpus: "Download Opus",
    statusError: "Error", statusLoading: "Loading", statusEncoding: "Encoding", statusRendering: "Rendering", ready: "Ready", cursorPosition: "Ln {line}, Col {column}", renderedDuration: "Duration", characters: "characters",
    renderCancelled: "Render cancelled", renderFailed: "Audio render failed", loadingOpus: "Loading Opus encoder…", opusReady: "Opus file ready", opusCancelled: "Encoding cancelled", opusFailed: "Opus encoding failed",
    player: { play: "Play", pause: "Pause", seek: "Playback position", generate: "Generate audio", cancel: "Cancel render", rendering: "Rendering audio", audioPlayer: "Announcement audio player", timeline: "Rendered audio timeline" },
  },
  zh: {
    appTitle: "公告编辑器", source: "项目源码", lang: "语言",
    loadingBank: "正在准备本地语音素材库…", urlStateInvalid: "URL 公告数据无效，未启动自动导出。", retry: "重试",
    bankLoadError: "语音素材库无法加载", phonemeIndexError: "无法加载音素索引",
    ribbonAria: "功能区", ribbonDoubleClick: "双击以折叠或展开功能区",
    ribbon: { home: "主页", insert: "插入", voice: "语音", timing: "时间", export: "导出", view: "视图" },
    group: { render: "渲染", markers: "标记", effects: "效果", timing: "时序", voice: "语音范围", phonemes: "音素", mix: "全局混音", processing: "语音后处理", pauses: "停顿与偏移", speed: "速度", reading: "朗读时长", download: "下载", layout: "布局", views: "侧栏视图", help: "帮助" },
    cmd: { render: "渲染" },
    tip: {
      render: "立即渲染公告（Ctrl/Cmd+Enter）", phonemes: "在光标处插入直接音素块",
      setting: "在设置侧栏中打开此控件", fit: "把选区包进标签，使其语音恰好持续指定秒数",
    },
    cancel: "取消任务", liveRender: "实时渲染", liveHelp: "更新音频但不自动播放",
    start: "开始", end: "结束", pause: "停顿", clip: "素材片段", stutter: "卡顿", pitch: "游戏音高", volume: "音量", rate: "语速", offset: "偏移", duration: "时长", spacing: "间隔", voice: "语音作用范围",
    insertPhonemes: "插入音素", wordGap: "词间间隔", voicePitch: "音调偏移（半音）", loudness: "响度（dB）", tension: "张力", breathiness: "气声", formant: "共振峰偏移（半音）",
    fitSeconds: "秒数", fit: "限定时长", wavShort: "WAV", opusShort: "Opus", sideBar: "侧栏", panel: "面板", ribbonToggle: "功能区", outline: "大纲", phonemeList: "音素", settings: "声音设置", help: "帮助",
    activityAria: "侧栏视图", outlineEmpty: "尚未检测到标签。", lineShort: "第 {line} 行",
    inventory: "可用音素（{count}）", insertPhone: "插入音素 {phone}", phoneTitle: "插入 / {phone} /",
    globalMix: "调整本次公告的全局混音。", pitchLabel: "游戏音高 {value}×", volumeLabel: "音量 {value}%", gapLabelSetting: "词间间隔 {value}s", rateLabel: "语速 {value}×",
    rateHelp: "只改变语音片段语速，不影响词间隔、停顿或提示音。",
    voiceProcessing: "语音后处理", voiceHelp: "使用浏览器内的 WORLD DSP。中性值保留原始录音。控制项只影响语音，不改变提示音或停顿；语速可单独调整。",
    voicePitchLabel: "音调偏移（{value} 半音）", loudnessLabel: "响度（{value} dB）", loudnessHelp: "调节语音响度，范围 −24 至 +12 dB；增益受峰值余量限制。",
    tensionLabel: "张力（{value}）", tensionHelp: "通过频谱倾斜让有声段更柔和（−1）或更明亮（+1）。", breathinessLabel: "气声（非周期声增强）：{value}", formantLabel: "共振峰偏移（{value} 半音）",
    missingWords: "未收录词合成", missingHelp: "优先使用录音，缺少时尝试音素拼合", enabled: "已开启",
    intro: "直接输入英文单词，也可手敲语音标签或 / 音素 /。", inlineExample: "词内效果示例：", markupReference: "标记参考",
    wholeWord: "整词效果：", markupStutter: "卡顿：", repeatHelp: "卡顿的 repeats 表示原始片段之后额外重复的次数。",
    cursorHelp: "可把标签放在词中，插入时不会添加空格。选择文字后，效果按钮会包住选区；在光标处插入时会选中占位单词。也可手动输入闭合标签。", wordPlaceholder: "word",
    standaloneHelp: "独立标记可自闭或省略尾斜线：", andWord: "与", equivalent: "等效。", brHelp: " 会停顿 0.5 秒。", brAlsoPauses: "也会停顿 0.5 秒。",
    pauseHelp: "停顿：", orWord: "或", listSeparator: "；", clipHelp: "素材：", comma: "，", replaceClipId: "将 ID 换成素材 ID。",
    phonemeHelp: "直接音素：", caseHelp: "已收录英文按大小写不敏感匹配；未收录的全大写词按英文字母名朗读。示例里的大写 A 是字母名，小写 a 是冠词，单独的 I 是代词。",
    rateExample: "语速示例：", fitExample: "朗读时长：", fitHelp: "拉伸或压缩标签内的语音，使其恰好持续指定秒数。这是倍速的逆向参数：指定的是时长，而不是倍率。",
    markupVolume: "音量：", markupTiming: "时序与间隔：", voiceExample: "语音作用范围示例：", voiceTagHelp: "只有标签内部的语音使用这些设置；闭合标签会恢复之前的值。", fullStop: "。",
    shortcuts: "快捷键", shortcutFocus: "聚焦编辑器", shortcutRender: "渲染公告", shortcutSideBar: "切换侧栏", about: "关于", sourceFooter: "源代码", licenses: "AGPL-3.0 与第三方许可",
    editorRegion: "公告编辑", editorTabsAria: "已打开的编辑器", editorAria: "公告内容", editorPlaceholder: "输入公告内容…", legendAria: "文本标记说明",
    recorded: "原始录音", synthesized: "合成音频", spellingHint: "拼写提示（仍尝试合成）", recognizedCommand: "识别命令", approximateOrError: "近似或错误",
    ordinaryText: "普通文本", gapLabel: "间隔", renderError: "渲染错误", dictionaryMissing: "词典未收录，仍可合成",
    panelAria: "面板", panelClose: "隐藏面板", panelPlayer: "播放器", panelProblems: "问题", analysis: "分析", output: "导出", noProblems: "未发现问题。", analysisEmpty: "暂无可分析的内容。",
    detectedPieces: "识别到 {count} 个语音片段", phonemes: "音素", localAudio: "音频在本机生成，不会上传文本。", encodingProgress: "正在编码 Opus", encoding: "正在编码",
    wav: "下载 WAV", exportOpus: "导出 Opus", downloadOpus: "下载 Opus",
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
  document.title = 'CASSIE · ' + t('appTitle');
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
  try { localStorage.setItem('cassie-locale', value); } catch { /* storage may be unavailable */ }
}, { immediate: true });
