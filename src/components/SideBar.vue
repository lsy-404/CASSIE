<script setup lang="ts">
import { t } from "../i18n";
import { SIDE_VIEW_LABELS, useStudio } from "../studio";
import HelpView from "./HelpView.vue";
import PhonemesView from "./PhonemesView.vue";
import SettingsView from "./SettingsView.vue";

const studio = useStudio();
</script>

<template>
  <div v-show="studio.sideBarOpen" class="sidebar-wrap">
    <aside class="sidebar" :aria-label="t(SIDE_VIEW_LABELS[studio.sideView])">
      <h2 class="sidebar-title">{{ t(SIDE_VIEW_LABELS[studio.sideView]) }}</h2>
      <div class="sidebar-scroll">
        <SettingsView v-show="studio.sideView === 'settings'" id="sidebar-settings" />
        <PhonemesView v-show="studio.sideView === 'phonemes'" id="sidebar-phonemes" />
        <HelpView v-show="studio.sideView === 'help'" id="sidebar-help" />
      </div>
    </aside>
    <button v-if="studio.compact" class="scrim" type="button" tabindex="-1" aria-hidden="true" @click="studio.sideBarOpen = false" />
  </div>
</template>

<style scoped>
.sidebar-wrap { flex: none; display: flex; min-height: 0; }
.sidebar { width: var(--ide-sidebar-width); min-height: 0; display: flex; flex-direction: column; background: var(--ide-sidebar); border-right: 1px solid var(--ide-border); }
.sidebar-title { margin: 0; flex: none; padding: 10px 16px 8px; font-size: 11px; font-weight: 400; letter-spacing: 0.1em; text-transform: uppercase; color: #bbbbbb; }
.sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 12px 16px; }
.scrim { display: none; }
@media (max-width: 819px) {
  .sidebar-wrap { position: absolute; z-index: 30; top: 0; bottom: 0; left: var(--ide-activitybar-width); right: 0; }
  .sidebar { width: min(var(--ide-sidebar-width), calc(100% - 40px)); box-shadow: 4px 0 16px rgba(0, 0, 0, 0.5); }
  .scrim { display: block; flex: 1; border: 0; padding: 0; background: rgba(0, 0, 0, 0.45); }
}
</style>
