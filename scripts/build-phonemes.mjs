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
const eligibleClips = bank.clips.filter((clip) => clip.kind === "word" && clip.id.length > 1 && /^[a-z]+(?:[-'][a-z]+)*$/i.test(clip.id));
const clipsToAlign = limit === undefined ? eligibleClips : eligibleClips.slice(0, limit);
const phones = new Map();
const failures = [];
let clipsWithInteriorPhones = 0;

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
    const result = await align(
      resolve(root, "public", clip.file.replace(/^\//, "")),
      transcript,
      { engine: "dtw", language: "en-US", crop: false },
      { logLevel: "warning" },
    );

    const wordEntries = result.wordTimeline.filter((entry) => entry.type === "word");
    let clipAddedPhones = 0;

    for (const wordEntry of wordEntries) {
      const wordPhones = flattenPhoneTimeline(wordEntry);
      for (const phone of wordPhones.slice(1, -1)) {
        const startSeconds = Number(phone.startTime.toFixed(6));
        const endSeconds = Number(phone.endTime.toFixed(6));
        const ipa = phone.text;
        const ipaKey = ipa.replace(/^[ˈˌ]/u, "").replace(/[ˈˌ]$/u, "");
        if (!ipaKey || endSeconds - startSeconds < 0.02) continue;
        if (startSeconds < 0 || endSeconds > clip.duration + 0.02) continue;

        const entry = {
          clipId: clip.id,
          ipa,
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

    if (clipAddedPhones) clipsWithInteriorPhones++;
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

const output = {
  schemaVersion: 1,
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
  },
  selection: {
    candidates: eligibleClips.length,
    processed: clipsToAlign.length,
    clipsWithInteriorPhones,
    phoneWindows: [...phones.values()].reduce((sum, entries) => sum + entries.length, 0),
    excludedWordEdges: true,
    minimumWindowSeconds: 0.02,
    failureCount: failures.length,
    failures,
  },
  phones: phoneIndex,
};

const json = `${JSON.stringify(output, null, 2)}\n`;
if (limit === undefined) {
  const publicOutput = join(root, "public", "phonemes.json");
  const manifestOutput = join(root, "data", "phonemes-manifest.json");
  await mkdir(dirname(publicOutput), { recursive: true });
  await mkdir(dirname(manifestOutput), { recursive: true });
  await writeFile(publicOutput, json, "utf8");
  await writeFile(manifestOutput, `${JSON.stringify({
    product: "CASSIE interior phoneme bank",
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
