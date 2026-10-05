import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankPath = join(root, "public", "bank.json");
const packageRoot = process.env.ECHOGARDEN_PACKAGE_PATH ?? join(root, "work", "phoneme-tools", "node_modules", "echogarden");
const packageJsonPath = join(packageRoot, "package.json");
const packageRequire = createRequire(packageJsonPath);
const echogardenPackage = packageRequire(packageJsonPath);
const { align } = await import(pathToFileURL(join(packageRoot, "dist", "api", "API.js")).href);
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex < 0 ? undefined : Number(process.argv[limitIndex + 1]);

if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit requires a positive integer");
}

const bankBytes = await readFile(bankPath);
const bank = JSON.parse(bankBytes.toString("utf8"));
const alignmentCacheRoot = join(root, "work", "phoneme-alignments");
await mkdir(alignmentCacheRoot, { recursive: true });
const eligibleClips = bank.clips.filter((clip) => clip.kind === "word" && clip.id.length > 1 && /^[a-z]+(?:[-'][a-z]+)*$/i.test(clip.id));
const clipsToAlign = limit === undefined ? eligibleClips : eligibleClips.slice(0, limit);
const phones = new Map();
const wordTimings = new Map();
const failures = [];
let clipsWithPhones = 0;
let wordTimingWindows = 0;
let clipsWithWordTimings = 0;

function normalizedTranscript(clip) {
  const sourceName = clip.sourceName ?? clip.id;
  const transcript = sourceName
    .replace(/[‐‑‒–—-]+/g, " ")
    .replace(/_/g, " ")
    .replace(/[().,:;!?]/g, " ")
    .replace(/[^A-Za-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return transcript && /^[A-Za-z']+(?: [A-Za-z']+)*$/.test(transcript) ? transcript : null;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function getAlignment(clip, transcript) {
  const cachePath = join(alignmentCacheRoot, `${clip.id}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (cached.sourceSha256 === clip.sha256 && cached.transcript === transcript && Array.isArray(cached.wordTimeline)) {
      return { wordTimeline: cached.wordTimeline };
    }
  } catch {
    // Missing or stale cache entries are realigned below.
  }

  const result = await align(
    resolve(root, "public", clip.file.replace(/^\//, "")),
    transcript,
    { engine: "dtw", language: "en-US", crop: false },
    { logLevel: "warning" },
  );
  await writeFile(cachePath, `${JSON.stringify({ sourceSha256: clip.sha256, transcript, wordTimeline: result.wordTimeline })}\n`, "utf8");
  return result;
}

function stressless(phone) {
  return phone.replace(/^[ˈˌ]/u, "").replace(/[ˈˌ]$/u, "");
}

function flattenPhoneTimeline(wordEntry) {
  return (wordEntry.timeline ?? []).flatMap((tokenEntry) => tokenEntry.timeline ?? []);
}

for (let index = 0; index < clipsToAlign.length; index++) {
  const clip = clipsToAlign[index];
  const transcript = normalizedTranscript(clip);
  if (!transcript) {
    failures.push({ clipId: clip.id, reason: "No safe English transcript could be derived from the source name." });
    continue;
  }

  try {
    const result = await getAlignment(clip, transcript);

    const wordEntries = result.wordTimeline.filter((entry) => entry.type === "word");
    const measuredWords = wordEntries.flatMap((entry) => {
      const startSeconds = Number(entry.startTime.toFixed(6));
      const endSeconds = Number(entry.endTime.toFixed(6));
      if (!entry.text || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
          startSeconds < 0 || endSeconds <= startSeconds || endSeconds > clip.duration) return [];
      return [{ text: entry.text, startSeconds, endSeconds }];
    });
    if (measuredWords.length > 1 && measuredWords.length === wordEntries.length) {
      wordTimings.set(clip.id, measuredWords);
      wordTimingWindows += measuredWords.length;
      clipsWithWordTimings++;
    }

    let clipAddedPhones = 0;

    for (const wordEntry of wordEntries) {
      const wordPhones = flattenPhoneTimeline(wordEntry);
      for (let phoneIndex = 0; phoneIndex < wordPhones.length; phoneIndex++) {
        const phone = wordPhones[phoneIndex];
        const startSeconds = Number(phone.startTime.toFixed(6));
        const endSeconds = Number(phone.endTime.toFixed(6));
        const ipa = phone.text;
        const ipaKey = ipa.replace(/^[ˈˌ]/u, "").replace(/[ˈˌ]$/u, "");
        if (!ipaKey || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds - startSeconds < 0.02) continue;
        if (startSeconds < 0 || endSeconds > clip.duration) continue;

        const position = wordPhones.length === 1
          ? "single"
          : phoneIndex === 0
            ? "initial"
            : phoneIndex === wordPhones.length - 1
              ? "final"
              : "medial";

        const entry = {
          clipId: clip.id,
          ipa,
          position,
          previousIpa: phoneIndex > 0 ? stressless(wordPhones[phoneIndex - 1].text) : null,
          nextIpa: phoneIndex + 1 < wordPhones.length ? stressless(wordPhones[phoneIndex + 1].text) : null,
          startSeconds,
          endSeconds,
          sourceDurationSeconds: clip.duration,
          sourceSha256: clip.sha256,
        };
        const entries = phones.get(ipaKey) ?? [];
        entries.push(entry);
        phones.set(ipaKey, entries);
        clipAddedPhones++;
      }
    }

    if (clipAddedPhones) clipsWithPhones++;
  } catch (error) {
    failures.push({ clipId: clip.id, reason: error instanceof Error ? error.message : String(error) });
  }

  if ((index + 1) % 50 === 0 || index + 1 === clipsToAlign.length) {
    console.error(`Aligned ${index + 1}/${clipsToAlign.length} clips`);
  }
}

const phoneIndex = Object.fromEntries(
  [...phones.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([ipaKey, entries]) => [
      ipaKey,
      entries.sort((left, right) => left.clipId.localeCompare(right.clipId, "en") || left.startSeconds - right.startSeconds),
    ]),
);

const wordTimingIndex = Object.fromEntries(
  [...wordTimings.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([clipId, entries]) => [clipId, entries.sort((left, right) => left.startSeconds - right.startSeconds)]),
);

const output = {
  schemaVersion: 2,
  sourceBank: {
    version: bank.version,
    sha256: hash(bankBytes),
  },
  aligner: {
    package: "echogarden",
    version: echogardenPackage.version,
    engine: "dtw",
    language: "en-US",
    timeline: "nested word/token/phone intervals from synthesis-reference MFCC dynamic-time-warping alignment",
    ipaKeyRule: "The lookup key removes a leading or trailing primary/secondary stress marker from the aligned IPA phone; the original aligned IPA label is retained on each window.",
    contextRule: "Phone position and neighboring IPA labels are taken from the full ordered phone timeline for each aligned word; neighboring labels omit stress markers.",
    wordTimingRule: "Multiword clip entries use Echogarden's measured top-level word intervals in seconds relative to the source clip.",
  },
  selection: {
    candidates: eligibleClips.length,
    processed: clipsToAlign.length,
    clipsWithPhones,
    phoneWindows: [...phones.values()].reduce((sum, entries) => sum + entries.length, 0),
    excludedWordEdges: false,
    minimumWindowSeconds: 0.02,
    clipsWithWordTimings,
    wordTimingWindows,
    failureCount: failures.length,
    failures,
  },
  phones: phoneIndex,
  wordTimings: wordTimingIndex,
};

const json = `${JSON.stringify(output, null, 2)}\n`;
if (limit === undefined) {
  const publicOutput = join(root, "public", "phonemes.json");
  const manifestOutput = join(root, "data", "phonemes-manifest.json");
  await mkdir(dirname(publicOutput), { recursive: true });
  await mkdir(dirname(manifestOutput), { recursive: true });
  await writeFile(publicOutput, json, "utf8");
  await writeFile(manifestOutput, `${JSON.stringify({
    product: "CASSIE phoneme and phrase word timing index",
    sourceBankVersion: bank.version,
    sourceBankSha256: hash(bankBytes),
    outputSha256: hash(Buffer.from(json)),
    aligner: output.aligner,
    selection: output.selection,
    licenseNote: "The source speech files remain SCP: Secret Laboratory assets under the included CC BY-SA 3.0 evidence. The phoneme-window generation code is part of this AGPL-3.0-only project; Echogarden alignment used eSpeak-NG reference synthesis.",
  }, null, 2)}\n`, "utf8");
} else {
  const previewOutput = join(root, "work", "phonemes-preview.json");
  await mkdir(dirname(previewOutput), { recursive: true });
  await writeFile(previewOutput, json, "utf8");
}

console.log(JSON.stringify(output.selection, null, 2));
