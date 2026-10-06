<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { t } from "../i18n";
import type { IconName } from "../icons";
import { ACTIVITY_VIEWS, SIDE_VIEW_LABELS, useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const list = ref<HTMLElement | null>(null);

const ICON_BY_VIEW: Record<(typeof ACTIVITY_VIEWS)[number], IconName> = { outline: "outline", phonemes: "phoneme", help: "help" };

const rovingView = computed(() => ACTIVITY_VIEWS.find((view) => view === studio.sideView) ?? ACTIVITY_VIEWS[0]);
function selected(view: (typeof ACTIVITY_VIEWS)[number]) { return studio.sideBarOpen && studio.sideView === view; }
function onKeydown(event: KeyboardEvent) {
  const current = ACTIVITY_VIEWS.indexOf(rovingView.value);
  const next = event.key === "ArrowDown" ? (current + 1) % ACTIVITY_VIEWS.length
    : event.key === "ArrowUp" ? (current - 1 + ACTIVITY_VIEWS.length) % ACTIVITY_VIEWS.length
      : event.key === "Home" ? 0 : event.key === "End" ? ACTIVITY_VIEWS.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  studio.sideView = ACTIVITY_VIEWS[next];
  void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-view="${ACTIVITY_VIEWS[next]}"]`)?.focus());
}
</script>

<template>
  <nav class="activitybar">
    <div ref="list" class="views" role="tablist" aria-orientation="vertical" :aria-label="t('activityAria')" @keydown="onKeydown">
      <button
        v-for="view in ACTIVITY_VIEWS"
        :key="view"
        type="button"
        role="tab"
        :data-view="view"
        :aria-selected="selected(view)"
        :aria-controls="`sidebar-${view}`"
        :tabindex="rovingView === view ? 0 : -1"
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
