import { ref, watch } from 'vue';
import { createI18n } from 'vue-i18n';

const messages = {
  en: {
    appTitle: "Announcement editor", source: "Source code ↗", heading: "Announcement editor",
    intro: "Type English words directly, or enter voice tags and / phonemes /.", loadingBank: "Preparing the local voice library…",
    retry: "Retry", announcement: "Announcement", characters: "characters", insertVoiceTags: "Voice tags", start: "Start", end: "End", pause: "Pause", stutter: "Stutter", voice: "Voice scope",
    inlineExample: "Inline example:", advanced: "Tags and help", pitch: "Game pitch", volume: "Volume", rate: "Speech rate", wordGap: "Word gap", offset: "Offset", duration: "Duration", spacing: "Spacing", clip: "Clip", insertPhonemes: "Insert phonemes",
    wholeWord: "Whole-word effect:", repeatHelp: "Stutter repeats the source fragment this many extra times.", cursorHelp: "You can place tags inside a word; insertion adds no spaces. Select text to wrap it in an effect, or insert at the cursor to select the placeholder word. You can also type closing tags yourself.",
    standaloneHelp: "Standalone tags may end with a slash or omit it:", brHelp: " pauses for 0.5 seconds.", pauseHelp: "Pause:", clipHelp: "Clip:", replaceClipId: "Replace the ID with an asset ID.", andWord: "and", orWord: "or", equivalent: "are equivalent.", brAlsoPauses: " also pauses for 0.5 seconds.", rateExample: "Rate example:", fullStop: ".", listSeparator: ";", comma: ",",
    phonemeHelp: "Direct phonemes:", caseHelp: "Recorded English is matched without regard to case. Unrecorded ALL-CAPS words are spoken as letter names. In the example, uppercase A is a letter name, lowercase a is the article, and standalone I is the pronoun.", phonemeIndexError: "Could not load the phoneme index", bankLoadError: "Could not load the voice library",
    wordPlaceholder: "word", editorPlaceholder: "Enter announcement text…", editorAria: "Announcement text", legendAria: "Text annotations", recorded: "Recorded audio", synthesized: "Synthesized audio", spellingHint: "Spelling hint (still synthesized)", recognizedCommand: "Recognized command", approximateOrError: "Approximation or error", ordinaryText: "Plain text", gapLabel: "Gap", renderError: "Render error", dictionaryMissing: "Not in dictionary; synthesis will still be attempted",
    audioPlayer: "Announcement audio player", liveRender: "Live render", liveHelp: "Updates audio without playing it automatically", analysis: "Speech analysis and notices", detectedPieces: "Detected {count} speech segments", phonemes: "Phonemes", otherNotices: "more notices", settings: "Sound settings", globalMix: "Adjust the global mix for this announcement.",
    pitchLabel: "Game pitch {value}×", volumeLabel: "Volume {value}%", gapLabelSetting: "Word gap {value}s", rateLabel: "Speech rate {value}×", rateHelp: "Changes spoken clip speed, not word gaps, pauses, or cues.", missingWords: "Unrecorded word synthesis", missingHelp: "Prefer recordings; try phoneme synthesis when unavailable", enabled: "On", inventory: "Available phonemes ({count})", insertPhone: "Insert phoneme {phone}", phoneTitle: "Insert / {phone} /",
    voiceProcessing: "Voice post-processing", voicePitch: "Pitch shift (semitones)", voicePitchLabel: "Pitch shift ({value} semitones)", breathiness: "Breathiness", breathinessLabel: "Breathiness (non-periodic energy): {value}", formant: "Formant shift (semitones)", formantLabel: "Formant shift ({value} semitones)", voiceHelp: "Uses the browser's WORLD DSP, not a trained DiffSinger neural model. All-zero values bypass processing and preserve original recordings. These controls affect speech only; they do not move start/end cues, pauses, or duration. Speech rate remains independently adjustable.", voiceExample: "Voice scope:", voiceTagHelp: "Only enclosed speech uses these values; the closing tag restores prior settings.",
    output: "Export", localAudio: "Audio is generated on this device; text is not uploaded.", encodingProgress: "Encoding Opus", encoding: "Encoding", cancel: "Cancel task", wav: "Download WAV", exportOpus: "Export Opus", downloadOpus: "Download Opus", renderNotice: "Render notice",
    renderCancelled: "Render cancelled", renderFailed: "Audio render failed", loadingOpus: "Loading Opus encoder…", opusReady: "Opus file ready", opusCancelled: "Encoding cancelled", opusFailed: "Opus encoding failed", sourceFooter: "Source code", licenses: "AGPL-3.0 and third-party licenses", studio: "Local audio studio", pageIntro: "Type English words directly, or enter voice tags and / phonemes /.", settingsRegion: "Render settings", editorRegion: "Announcement editor", lang: "Language", english: "English", chinese: "中文",
    player: { play: "Play", pause: "Pause", seek: "Playback position", currentTime: "Current time", duration: "Duration", generate: "Generate audio", cancel: "Cancel render", rendering: "Rendering audio", audioPlayer: "Announcement audio player" },
  },
  zh: {
    appTitle: "公告编辑器", source: "项目源码 ↗", heading: "公告编辑器", intro: "直接输入英文单词，也可手敲语音标签或 / 音素 /。", loadingBank: "正在准备本地语音素材库…",
    retry: "重试", announcement: "公告内容", characters: "字符", insertVoiceTags: "插入语音标签", start: "开始", end: "结束", pause: "停顿", stutter: "卡顿", voice: "语音作用范围",
    inlineExample: "词内效果示例：", advanced: "语音标签与用法", pitch: "游戏音高", volume: "音量", rate: "语速", wordGap: "词间间隔", offset: "偏移", duration: "时长", spacing: "间隔", clip: "素材片段", insertPhonemes: "插入音素",
    wholeWord: "整词效果：", repeatHelp: "卡顿的 repeats 表示原始片段之后额外重复的次数。", cursorHelp: "可把标签放在词中，插入时不会添加空格。选择文字后，效果按钮会包住选区；在光标处插入时会选中占位单词。也可手动输入闭合标签。",
    standaloneHelp: "独立标记可自闭或省略尾斜线：", brHelp: " 会停顿 0.5 秒。", pauseHelp: "停顿：", clipHelp: "素材：", replaceClipId: "将 ID 换成素材 ID。", andWord: "与", orWord: "或", equivalent: "等效。", brAlsoPauses: "也会停顿 0.5 秒。", rateExample: "语速示例：", fullStop: "。", listSeparator: "；", comma: "，",
    phonemeHelp: "直接音素：", caseHelp: "已收录英文按大小写不敏感匹配；未收录的全大写词按英文字母名朗读。示例里的大写 A 是字母名，小写 a 是冠词，单独的 I 是代词。", phonemeIndexError: "无法加载音素索引", bankLoadError: "语音素材库无法加载",
    wordPlaceholder: "word", editorPlaceholder: "输入公告内容…", editorAria: "公告内容", legendAria: "文本标记说明", recorded: "原始录音", synthesized: "合成音频", spellingHint: "拼写提示（仍尝试合成）", recognizedCommand: "识别命令", approximateOrError: "近似或错误", ordinaryText: "普通文本", gapLabel: "间隔", renderError: "渲染错误", dictionaryMissing: "词典未收录，仍可合成",
    audioPlayer: "公告音频播放器", liveRender: "实时渲染", liveHelp: "更新音频但不自动播放", analysis: "语音分析与提示", detectedPieces: "识别到 {count} 个语音片段", phonemes: "音素", otherNotices: "条提示", settings: "声音设置", globalMix: "调整本次公告的全局混音。",
    pitchLabel: "游戏音高 {value}×", volumeLabel: "音量 {value}%", gapLabelSetting: "词间间隔 {value}s", rateLabel: "语速 {value}×", rateHelp: "只改变语音片段语速，不影响词间隔、停顿或提示音。", missingWords: "未收录词合成", missingHelp: "优先使用录音，缺少时尝试音素拼合", enabled: "已开启", inventory: "可用音素（{count}）", insertPhone: "插入音素 {phone}", phoneTitle: "插入 / {phone} /",
    voiceProcessing: "语音后处理", voicePitch: "音调偏移（半音）", voicePitchLabel: "音调偏移（{value} 半音）", breathiness: "气声", breathinessLabel: "气声（非周期声增强）：{value}", formant: "共振峰偏移（半音）", formantLabel: "共振峰偏移（{value} 半音）", voiceHelp: "使用浏览器内的 WORLD DSP 处理，不是训练 DiffSinger 神经模型。三个值都为 0 时会跳过处理并保留原始录音。后处理只作用于语音，不改变开始/结束提示、停顿或时长；语速仍可单独调节。", voiceExample: "语音作用范围示例：", voiceTagHelp: "只有标签内部的语音使用这些设置；闭合标签会恢复之前的值。",
    output: "导出", localAudio: "音频在本机生成，不会上传文本。", encodingProgress: "正在编码 Opus", encoding: "正在编码", cancel: "取消任务", wav: "下载 WAV", exportOpus: "导出 Opus", downloadOpus: "下载 Opus", renderNotice: "渲染提示",
    renderCancelled: "渲染已取消", renderFailed: "音频渲染失败", loadingOpus: "正在加载 Opus 编码器…", opusReady: "Opus 文件已就绪", opusCancelled: "编码已取消", opusFailed: "Opus 编码失败", sourceFooter: "源代码", licenses: "AGPL-3.0 与第三方许可", studio: "本地音频工作室", pageIntro: "直接输入英文单词，也可手敲语音标签或 / 音素 /。", settingsRegion: "渲染设置", editorRegion: "公告编辑", lang: "语言", english: "English", chinese: "中文",
    player: { play: "播放", pause: "暂停", seek: "播放位置", currentTime: "当前时间", duration: "总时长", generate: "生成音频", cancel: "取消渲染", rendering: "正在渲染音频", audioPlayer: "公告音频播放器" },
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
