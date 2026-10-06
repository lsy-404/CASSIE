<script setup lang="ts">
import { FluentSwitch } from "@platform-kit/fluent/vue";
import { t } from "../i18n";
import { phonemeEngineError } from "../phoneme-engine";
import { useStudio } from "../studio";
import FineControl from "./FineControl.vue";

type Model = "pitch" | "volume" | "gap" | "rate" | "voicePitch" | "loudness" | "tension" | "breathiness" | "formant";
interface Control { model: Model; label: string; min: number; max: number; step: number; help?: string }

const MIX: Control[] = [
  { model: "pitch", label: "pitch", min: 0.65, max: 1.35, step: 0.01 },
  { model: "volume", label: "volume", min: 0, max: 1, step: 0.01 },
  { model: "gap", label: "wordGap", min: 0, max: 0.8, step: 0.01 },
  { model: "rate", label: "rate", min: 0.5, max: 2, step: 0.01 },
];
const PROCESSING: Control[] = [
  { model: "voicePitch", label: "voicePitch", min: -12, max: 12, step: 0.1 },
  { model: "loudness", label: "loudness", min: -24, max: 12, step: 0.1, help: "tip.loudness" },
  { model: "tension", label: "tension", min: -1, max: 1, step: 0.01, help: "tip.tension" },
  { model: "breathiness", label: "breathiness", min: 0, max: 1, step: 0.01 },
  { model: "formant", label: "formant", min: -6, max: 6, step: 0.1 },
];

const studio = useStudio();
</script>

<template>
  <div class="settings">
    <section v-for="section in [{ id: 'mix', controls: MIX }, { id: 'processing', controls: PROCESSING }]" :key="section.id" :data-section="section.id">
      <h3>{{ t(`group.${section.id}`) }}</h3>
      <p v-if="section.id === 'processing'" class="help">{{ t('voiceHelp') }}</p>
      <div v-for="control in section.controls" :key="control.model" class="control">
        <span class="name">{{ t(control.label) }}</span>
        <FineControl v-model="studio[control.model]" :min="control.min" :max="control.max" :step="control.step" :label="t(control.label)" />
        <p v-if="control.help" class="help">{{ t(control.help) }}</p>
      </div>
    </section>
    <section data-section="synthesis">
      <h3>{{ t('unrecordedWords') }}</h3>
      <FluentSwitch v-model="studio.synthesizeUnrecorded" :label="t('unrecordedWords')" :disabled="!!phonemeEngineError" />
      <p v-if="phonemeEngineError" class="help" data-testid="phoneme-unavailable">{{ t('phonemeUnavailable', { reason: phonemeEngineError }) }}</p>
      <p class="help">{{ t('unrecordedHelp') }}</p>
    </section>
  </div>
</template>

<style scoped>
.settings { display: grid; gap: 4px; font-size: 12px; }
h3 { margin: 12px 0 8px; font-size: 11px; font-weight: 400; letter-spacing: 0.1em; text-transform: uppercase; color: #bbbbbb; }
section:first-child h3 { margin-top: 4px; }
.control { display: grid; gap: 2px; margin-bottom: 8px; }
.name { color: #d4d4d4; }
.help { margin: 0 0 6px; color: var(--fluent-muted); line-height: 1.5; }
</style>
