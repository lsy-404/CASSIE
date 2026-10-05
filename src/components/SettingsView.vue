<script setup lang="ts">
import { t } from "../i18n";
import { useStudio } from "../studio";
import FineControl from "./FineControl.vue";

const studio = useStudio();
</script>

<template>
  <div class="settings">
    <p class="lead">{{ t('globalMix') }}</p>
    <label data-setting="pitch"><span>{{ t('pitchLabel', { value: studio.pitch.toFixed(2) }) }}</span><FineControl v-model="studio.pitch" :min="0.65" :max="1.35" :step="0.01" :label="t('pitch')" /></label>
    <label data-setting="volume"><span>{{ t('volumeLabel', { value: Math.round(studio.volume * 100) }) }}</span><FineControl v-model="studio.volume" :min="0" :max="1" :step="0.01" :label="t('volume')" /></label>
    <label data-setting="gap"><span>{{ t('gapLabelSetting', { value: studio.gap.toFixed(2) }) }}</span><FineControl v-model="studio.gap" :min="0" :max="0.8" :step="0.01" :label="t('wordGap')" /></label>
    <label data-setting="rate"><span>{{ t('rateLabel', { value: studio.rate.toFixed(2) }) }}<small>{{ t('rateHelp') }}</small></span><FineControl v-model="studio.rate" :min="0.5" :max="2" :step="0.01" :label="t('rate')" /></label>
    <section class="voice-processing" :aria-label="t('voiceProcessing')">
      <h3>{{ t('voiceProcessing') }}</h3>
      <p>{{ t('voiceHelp') }}</p>
      <label data-setting="voicePitch"><span>{{ t('voicePitchLabel', { value: studio.voicePitch.toFixed(1) }) }}</span><FineControl v-model="studio.voicePitch" :min="-12" :max="12" :step="0.1" :label="t('voicePitch')" /></label>
      <label data-setting="loudness"><span>{{ t('loudnessLabel', { value: studio.loudness.toFixed(1) }) }}</span><FineControl v-model="studio.loudness" :min="-24" :max="12" :step="0.1" :label="t('loudness')" /></label>
      <p class="control-help">{{ t('loudnessHelp') }}</p>
      <label data-setting="tension"><span>{{ t('tensionLabel', { value: studio.tension.toFixed(2) }) }}</span><FineControl v-model="studio.tension" :min="-1" :max="1" :step="0.01" :label="t('tension')" /></label>
      <p class="control-help">{{ t('tensionHelp') }}</p>
      <label data-setting="breathiness"><span>{{ t('breathinessLabel', { value: studio.breathiness.toFixed(2) }) }}</span><FineControl v-model="studio.breathiness" :min="0" :max="1" :step="0.01" :label="t('breathiness')" /></label>
      <label data-setting="formant"><span>{{ t('formantLabel', { value: studio.formant.toFixed(1) }) }}</span><FineControl v-model="studio.formant" :min="-6" :max="6" :step="0.1" :label="t('formant')" /></label>
    </section>
    <div class="phoneme-setting"><span>{{ t('missingWords') }}<small>{{ t('missingHelp') }}</small></span><span class="setting-state">{{ t('enabled') }}</span></div>
  </div>
</template>

<style scoped>
.settings { display: grid; gap: 14px; }
p { margin: 0; }
.lead { color: var(--fluent-muted); font-size: 12px; }
label { display: grid; gap: 4px; }
label > span, .phoneme-setting { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; color: #d4d4d4; }
label > span small, .phoneme-setting small { display: block; margin-top: 3px; color: var(--fluent-muted); font-size: 11px; line-height: 1.45; }
.voice-processing { display: grid; gap: 12px; padding-top: 14px; border-top: 1px solid var(--ide-border-strong); }
.voice-processing h3 { margin: 0; font-size: 11px; font-weight: 400; letter-spacing: 0.1em; text-transform: uppercase; color: #bbbbbb; }
.voice-processing > p { color: var(--fluent-muted); font-size: 11px; line-height: 1.5; }
.voice-processing .control-help { margin-top: -8px; }
.phoneme-setting { padding-top: 12px; border-top: 1px solid var(--ide-border-strong); }
.setting-state { color: var(--fluent-success); }
</style>
