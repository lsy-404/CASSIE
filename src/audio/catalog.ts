import type { BankClip } from "./types";

export interface ClipUsage {
  category: string;
  label: string;
  insertText: string;
  description: string;
}

export const announcementCueIds = {
  start: null,
  end: null,
} as const satisfies { start: string | null; end: string | null };

const categoryLabels = {
  word: "语音词条",
  phrase: "完整短语",
  digit: "数字",
  letter: "字母",
  prefix: "前缀片段",
  suffix: "后缀片段",
  article: "冠词变体",
  pause: "停顿片段",
  background: "背景音",
  effect: "音效",
} as const;

const chineseNames: Record<string, string> = {
  "all-remaining-personnel": "全体剩余人员",
  "cassie-background-std": "CASSIE 标准背景音",
  the_consonant: "辅音前冠词",
  the_vowel: "元音前冠词",
  _silence: "静音停顿",
};

const completePhrases = new Set(["all-remaining-personnel"]);

function getCategory(clip: BankClip): keyof typeof categoryLabels {
  if (clip.id === "cassie-background-std") return "background";
  if (clip.kind === "effect") return "effect";
  if (clip.id.endsWith("_silence")) return "pause";
  if (clip.id.includes("_suffix_")) return "suffix";
  if (clip.id.startsWith("the_")) return "article";
  if (/^_[a-z]$/i.test(clip.id)) return "letter";
  if (clip.id.startsWith("-") && clip.id.length > 1) return "suffix";
  if (clip.id.endsWith("-") && clip.id.length > 1) return "prefix";
  if (/^\d+$/.test(clip.id)) return "digit";
  if (/^[a-z]$/i.test(clip.id)) return "letter";
  if (completePhrases.has(clip.id)) return "phrase";
  return "word";
}

export function getClipUsage(clip: BankClip): ClipUsage {
  const category = getCategory(clip);
  const internalLetter = /^_[a-z]$/i.test(clip.id);
  const needsExplicitClipCommand = internalLetter || ["prefix", "suffix", "article", "pause", "background", "effect"].includes(category);
  const insertText = needsExplicitClipCommand ? `$CLIP_${clip.id}` : clip.id;
  const name = chineseNames[clip.id] ?? clip.id.replace(/^_([a-z])$/i, "$1").replaceAll("-", " ").replaceAll("_", " ");
  const speechReady = !internalLetter && ["word", "phrase", "digit", "letter"].includes(category);

  return {
    category: categoryLabels[category],
    label: `${categoryLabels[category]}：${name}`,
    insertText,
    description: speechReady
      ? `可直接输入「${clip.id}」播报。`
      : `这是可用的${categoryLabels[category]}，需通过「${insertText}」插入。`,
  };
}
