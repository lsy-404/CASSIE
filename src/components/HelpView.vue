<script setup lang="ts">
import { t } from "../i18n";
</script>

<template>
  <div class="help">
    <p>{{ t('intro') }}</p>
    <p>{{ t('inlineExample') }} <code>me&lt;pitch value="1.2"&gt;tri&lt;/pitch&gt;cs</code></p>
    <h3>{{ t('legend') }}</h3>
    <div class="legend" data-testid="legend">
      <p class="legend-title">{{ t('legendEditor') }}</p>
      <span class="token-marker">{{ t('recognizedCommand') }}</span>
      <span class="token-recorded">{{ t('recorded') }}</span>
      <span class="token-synthesized">{{ t('synthesized') }}</span>
      <span class="token-error">{{ t('cannotSynthesize') }}</span>
      <span class="token-synthesized fixable">{{ t('legendWavy') }}</span>
      <span class="token-synthesized blocked">{{ t('legendDashed') }}</span>
      <p class="legend-title">{{ t('legendTimeline') }}</p>
      <span class="swatch recorded">{{ t('recorded') }}</span>
      <span class="swatch synthesized">{{ t('synthesized') }}</span>
      <span class="swatch cue">{{ t('legendCue') }}</span>
      <span class="swatch gap">{{ t('legendGap') }}</span>
      <span class="swatch lane">{{ t('legendSyncLane') }}</span>
    </div>
    <h3>{{ t('markupReference') }}</h3>
    <div class="help-examples">
      <p>{{ t('wholeWord') }} <code>&lt;pitch value="1.2"&gt;attention&lt;/pitch&gt;</code>{{ t('fullStop') }} {{ t('markupStutter') }} <code>&lt;stutter repeats="2" length="0.1"&gt;attention&lt;/stutter&gt;</code>{{ t('fullStop') }} {{ t('repeatHelp') }}</p>
      <p>{{ t('cursorHelp') }} <code>{{ t('wordPlaceholder') }}</code>{{ t('fullStop') }}</p>
      <p>{{ t('standaloneHelp') }} <code>&lt;start&gt;</code>/<code>&lt;start/&gt;</code> {{ t('andWord') }} <code>&lt;end&gt;</code>/<code>&lt;end/&gt;</code> {{ t('equivalent') }} <code>&lt;br&gt;</code>{{ t('brHelp') }}<code>&lt;br/&gt;</code>{{ t('brAlsoPauses') }}</p>
      <p>{{ t('pauseHelp') }} <code>&lt;pause seconds="0.5"&gt;</code> {{ t('orWord') }} <code>&lt;pause seconds="0.5"/&gt;</code>{{ t('listSeparator') }} {{ t('clipHelp') }} <code>&lt;clip id="cassie"&gt;</code> {{ t('orWord') }} <code>&lt;clip id="cassie"/&gt;</code>{{ t('comma') }} {{ t('replaceClipId') }}</p>
      <p>{{ t('phonemeHelp') }} <code>/ a e: /</code>{{ t('fullStop') }} {{ t('caseHelp') }}</p>
      <p>{{ t('rateExample') }} <code>&lt;rate value="1.2"&gt;attention&lt;/rate&gt;</code>{{ t('fullStop') }} {{ t('rateHelp') }}</p>
      <p>{{ t('fitExample') }} <code>&lt;fit seconds="2"&gt;attention all personnel&lt;/fit&gt;</code>{{ t('fullStop') }} {{ t('fitHelp') }}</p>
      <p>{{ t('markupVolume') }} <code>&lt;volume value="0.7"&gt;attention&lt;/volume&gt;</code>{{ t('fullStop') }}</p>
      <p>{{ t('markupTiming') }} <code>&lt;offset seconds="0.1"&gt;attention&lt;/offset&gt;</code>{{ t('comma') }} <code>&lt;duration seconds="0.3"&gt;attention&lt;/duration&gt;</code>{{ t('comma') }} <code>&lt;spacing seconds="0.2"&gt;attention&lt;/spacing&gt;</code>{{ t('fullStop') }}</p>
      <p>{{ t('voiceExample') }} <code>&lt;voice pitch="3" loudness="2" tension="0.2" breathiness="0.3" formant="-2"&gt;attention&lt;/voice&gt;</code>{{ t('fullStop') }} {{ t('voiceTagHelp') }}</p>
      <p>{{ t('syncExample') }} <code>&lt;sync&gt;&lt;voice pitch="4"&gt;contain&lt;/voice&gt;&lt;/sync&gt; contain</code>{{ t('fullStop') }} {{ t('syncEchoExample') }} <code>&lt;sync&gt;&lt;volume value="0.5"&gt;&lt;pause seconds="0.15"/&gt;contain&lt;/volume&gt;&lt;/sync&gt; contain</code>{{ t('fullStop') }} {{ t('syncHelp') }}</p>
      <p>{{ t('strictHelp') }}</p>
      <p>{{ t('engineHelp') }}</p>
    </div>
    <h3>{{ t('shortcuts') }}</h3>
    <dl>
      <dt><kbd>/</kbd></dt><dd>{{ t('shortcutFocus') }}</dd>
      <dt><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dt><dd>{{ t('shortcutRender') }}</dd>
      <dt><kbd>Ctrl/⌘</kbd> + <kbd>B</kbd></dt><dd>{{ t('shortcutSideBar') }}</dd>
    </dl>
    <h3>{{ t('about') }}</h3>
    <p>{{ t('localAudio') }}</p>
    <p class="links"><a href="https://github.com/lsy-404/CASSIE" target="_blank" rel="noreferrer">{{ t('sourceFooter') }}</a><a href="/licenses.html">{{ t('licenses') }}</a></p>
  </div>
</template>

<style scoped>
.help { font-size: 12px; line-height: 1.6; color: #cccccc; }
p { margin: 0 0 8px; }
h3 { margin: 16px 0 8px; font-size: 11px; font-weight: 400; letter-spacing: 0.1em; text-transform: uppercase; color: #bbbbbb; }
code { font: 11px var(--ide-mono); color: #e6e6e6; overflow-wrap: anywhere; }
.help-examples { display: grid; gap: 4px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
dt, dd { margin: 0; }
kbd { padding: 1px 5px; border: 1px solid var(--ide-border-strong); border-radius: 3px; background: #333; font: 11px var(--ide-mono); }
.legend { display: grid; justify-items: start; gap: 4px; }
.legend-title { margin: 6px 0 0; color: #bbbbbb; }
.legend span { text-decoration-thickness: 2px; text-underline-offset: 3px; }
.legend span[class*="token-"] { text-decoration-line: underline; }
.swatch { display: inline-flex; align-items: center; gap: 8px; }
.swatch::before { content: ""; width: 24px; height: 6px; border: 1px solid var(--ide-border-strong); }
.swatch.recorded::before { background: var(--token-recorded); }
.swatch.synthesized::before { background: var(--token-synthesized); }
.swatch.cue::before { background: var(--token-cue); }
.swatch.lane::before { height: 3px; background: var(--token-recorded); }
.links { display: grid; gap: 4px; }
.links a { text-decoration: underline; text-underline-offset: 2px; }
.links a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
</style>
