<script setup lang="ts">
import { t } from "../i18n";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <strong>C.A.S.S.I.E.</strong>
      <span class="brand-full">CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES</span>
    </div>
    <h1 class="doc-title"><span class="doc-name">announcement.cassie</span><span class="app-title">{{ t('appTitle') }}</span></h1>
    <div class="actions">
      <a class="source" href="https://github.com/lsy-404/CASSIE" target="_blank" rel="noreferrer" :aria-label="t('source')" :title="t('source')"><AppIcon name="external" /><span>{{ t('source') }}</span></a>
      <button class="globe" type="button" :aria-label="t('lang')" :title="studio.compact ? undefined : t('lang')" @click="studio.toggleLocale"><AppIcon name="globe" :size="18" /></button>
    </div>
  </header>
</template>

<style scoped>
.titlebar { flex: none; height: var(--ide-titlebar-height); display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; padding: 0 6px 0 12px; background: var(--ide-titlebar); border-bottom: 1px solid var(--ide-border); }
.brand { min-width: 0; display: flex; align-items: baseline; gap: 12px; white-space: nowrap; }
.brand strong { font: 600 13px var(--ide-mono); letter-spacing: 0.22em; color: #fff; }
.brand-full { overflow: hidden; text-overflow: ellipsis; font: 9px var(--ide-mono); letter-spacing: 0.08em; color: #a0a0a0; }
.doc-title { margin: 0; display: flex; gap: 8px; align-items: baseline; font-size: 12px; font-weight: 400; color: #cccccc; white-space: nowrap; }
.doc-name { font-family: var(--ide-mono); }
.app-title::before { content: "—"; margin-right: 8px; color: #8c8c8c; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.source, .globe { height: 26px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 0; border-radius: 3px; background: transparent; color: #cccccc; font-size: 12px; text-decoration: none; cursor: pointer; }
.source:hover, .globe:hover { background: var(--ide-hover); color: #fff; }
.source:focus-visible, .globe:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
@media (max-width: 1100px) { .brand-full { display: none; } }
@media (max-width: 820px) {
  .titlebar { grid-template-columns: auto minmax(0, 1fr) auto; }
  .doc-title { justify-content: center; min-width: 0; overflow: hidden; }
  .app-title { display: none; }
  .source span { display: none; }
}
@media (max-width: 480px) { .doc-title { display: none; } .titlebar { grid-template-columns: 1fr auto; } }
</style>
