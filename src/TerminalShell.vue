<script setup lang="ts">
import App from './App.vue';
import TerminalEntry from './components/TerminalEntry.vue';
import { setLocale } from './i18n';
import { decodeUrlState, type DecodedUrlState } from './url-state';

let launchState: DecodedUrlState | null = null;
let urlError = false;
try {
  launchState = decodeUrlState(window.location.search);
  if (launchState?.locale) setLocale(launchState.locale);
} catch {
  urlError = true;
}
</script>

<template>
  <TerminalEntry>
    <App :initial-state="launchState" :url-error="urlError" />
  </TerminalEntry>
</template>
