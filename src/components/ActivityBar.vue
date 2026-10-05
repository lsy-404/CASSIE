<script setup lang="ts">
import { nextTick, ref } from "vue";
import { t } from "../i18n";
import type { IconName } from "../icons";
import { SIDE_VIEW_LABELS, SIDE_VIEWS, useStudio, type SideView } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const list = ref<HTMLElement | null>(null);

const ICON_BY_VIEW: Record<SideView, IconName> = { outline: "outline", phonemes: "phoneme", settings: "sliders", help: "help" };

function selected(view: SideView) { return studio.sideBarOpen && studio.sideView === view; }
function onKeydown(event: KeyboardEvent) {
  const current = SIDE_VIEWS.indexOf(studio.sideView);
  const next = event.key === "ArrowDown" ? (current + 1) % SIDE_VIEWS.length
    : event.key === "ArrowUp" ? (current - 1 + SIDE_VIEWS.length) % SIDE_VIEWS.length
      : event.key === "Home" ? 0 : event.key === "End" ? SIDE_VIEWS.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  studio.sideView = SIDE_VIEWS[next];
  void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-view="${SIDE_VIEWS[next]}"]`)?.focus());
}
</script>

<template>
  <nav class="activitybar">
    <div ref="list" class="views" role="tablist" aria-orientation="vertical" :aria-label="t('activityAria')" @keydown="onKeydown">
      <button
        v-for="view in SIDE_VIEWS"
        :key="view"
        type="button"
        role="tab"
        :data-view="view"
        :aria-selected="selected(view)"
        :aria-controls="`sidebar-${view}`"
        :tabindex="studio.sideView === view ? 0 : -1"
        :title="t(SIDE_VIEW_LABELS[view])"
        :aria-label="t(SIDE_VIEW_LABELS[view])"
        @click="studio.showSideView(view)"
      ><AppIcon :name="ICON_BY_VIEW[view]" :size="22" /></button>
    </div>
  </nav>
</template>

<style scoped>
.activitybar { flex: none; width: var(--ide-activitybar-width); background: var(--ide-activitybar); border-right: 1px solid var(--ide-border); }
.views { display: flex; flex-direction: column; }
button { position: relative; width: 100%; height: var(--ide-activitybar-width); display: grid; place-items: center; border: 0; background: transparent; color: #8c8c8c; cursor: pointer; }
button:hover { color: #fff; }
button[aria-selected="true"] { color: #fff; }
button[aria-selected="true"]::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: #fff; }
button:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
</style>
