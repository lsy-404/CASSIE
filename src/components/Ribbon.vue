<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { t } from "../i18n";
import { RIBBON_TABS, type RibbonTabId, type ButtonCommand, type NumberCommand, type RibbonCommand, type RibbonGroup } from "../ribbon";
import { boundedNumber } from "../editor";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const tabList = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const groupsEl = ref<HTMLElement | null>(null);
const overflow = ref({ left: false, right: false });
let collapsedAtClick = false;
const activeTab = computed(() => RIBBON_TABS.find((tab) => tab.id === studio.ribbonTab) ?? RIBBON_TABS[0]);

type Item = { large: ButtonCommand } | { stack: RibbonCommand[] };

function layout(group: RibbonGroup): Item[] {
  const items: Item[] = [];
  for (const command of group.commands) {
    if (command.kind !== "number" && command.size === "large") { items.push({ large: command }); continue; }
    const last = items[items.length - 1];
    if (last && "stack" in last && last.stack.length < 3) last.stack.push(command);
    else items.push({ stack: [command] });
  }
  return items;
}

function enabled(command: RibbonCommand) { return command.enabled ? command.enabled(studio) : true; }
function pressed(command: ButtonCommand) { return command.pressed ? command.pressed(studio) : undefined; }
function tip(command: RibbonCommand) { return t(command.tip ?? command.label); }

function onTabClick(id: RibbonTabId, event: MouseEvent) {
  if (event.detail > 1) return;
  collapsedAtClick = studio.ribbonCollapsed;
  studio.ribbonTab = id;
  studio.ribbonCollapsed = false;
}
function onTabDblclick(id: RibbonTabId) { if (id === studio.ribbonTab) studio.ribbonCollapsed = !collapsedAtClick; }
function measure() {
  const element = body.value;
  overflow.value = element
    ? { left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 }
    : { left: false, right: false };
}
function scrollBody(direction: -1 | 1) { body.value?.scrollBy({ left: direction * 160, behavior: "smooth" }); }
function onTabKeydown(event: KeyboardEvent) {
  const ids = RIBBON_TABS.map((tab) => tab.id);
  const current = ids.indexOf(studio.ribbonTab);
  const next = event.key === "ArrowRight" ? (current + 1) % ids.length
    : event.key === "ArrowLeft" ? (current - 1 + ids.length) % ids.length
      : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  studio.ribbonTab = ids[next];
  void nextTick(() => tabList.value?.querySelector<HTMLElement>(`#ribbon-tab-${ids[next]}`)?.focus());
}
const observer = new ResizeObserver(measure);
watch([body, groupsEl], ([element, groups], [oldElement, oldGroups]) => {
  if (oldElement) observer.unobserve(oldElement);
  if (oldGroups) observer.unobserve(oldGroups);
  if (element) observer.observe(element);
  if (groups) observer.observe(groups);
  measure();
}, { flush: "post" });
onBeforeUnmount(() => observer.disconnect());
function commitNumber(command: NumberCommand) {
  studio[command.model] = boundedNumber(studio[command.model], command.min, command.max) ?? command.default;
}
</script>

<template>
  <section class="ribbon" :aria-label="t('ribbonAria')">
    <div ref="tabList" class="ribbon-tabs" role="tablist" :aria-label="t('ribbonAria')" @keydown="onTabKeydown">
      <button
        v-for="tab in RIBBON_TABS"
        :id="`ribbon-tab-${tab.id}`"
        :key="tab.id"
        class="ribbon-tab"
        type="button"
        role="tab"
        :aria-selected="studio.ribbonTab === tab.id"
        :aria-controls="studio.ribbonCollapsed ? undefined : 'ribbon-body'"
        :tabindex="studio.ribbonTab === tab.id ? 0 : -1"
        :title="studio.ribbonTab === tab.id ? t('ribbonDoubleClick') : undefined"
        @click="onTabClick(tab.id, $event)"
        @dblclick="onTabDblclick(tab.id)"
      >{{ t(tab.label) }}</button>
    </div>
    <div v-if="!studio.ribbonCollapsed" class="ribbon-row">
      <button v-show="overflow.left" class="rb-scroll" type="button" tabindex="-1" aria-hidden="true" @click="scrollBody(-1)"><AppIcon name="chevronLeft" /></button>
      <div id="ribbon-body" ref="body" class="ribbon-body" role="tabpanel" :aria-labelledby="`ribbon-tab-${activeTab.id}`" @scroll.passive="measure">
        <div ref="groupsEl" class="ribbon-groups">
        <div v-for="group in activeTab.groups" :key="group.id" class="rb-group" role="group" :aria-label="t(group.label)">
          <div class="rb-commands">
            <template v-for="(item, index) in layout(group)" :key="index">
              <button
                v-if="'large' in item"
                class="rb-btn rb-large"
                type="button"
                :data-command="item.large.id"
                :disabled="!enabled(item.large)"
                :aria-pressed="pressed(item.large)"
                :title="tip(item.large)"
                @click="studio.run(item.large.action)"
              ><AppIcon :name="item.large.icon" :size="24" /><span>{{ t(item.large.label) }}</span></button>
              <div v-else class="rb-stack">
                <template v-for="command in item.stack" :key="command.id">
                  <label v-if="command.kind === 'number'" class="rb-number" :title="tip(command)">
                    <AppIcon :name="command.icon" />
                    <span>{{ t(command.label) }}</span>
                    <input
                      v-model.number="studio[command.model]"
                      type="number"
                      :min="command.min"
                      :max="command.max"
                      :step="command.step"
                      :aria-label="t(command.label)"
                      :data-command="command.id"
                      :disabled="!enabled(command)"
                      @change="commitNumber(command)"
                    />
                  </label>
                  <button
                    v-else
                    class="rb-btn rb-small"
                    type="button"
                    :data-command="command.id"
                    :disabled="!enabled(command)"
                    :aria-pressed="pressed(command)"
                    :title="tip(command)"
                    @click="studio.run(command.action)"
                  ><AppIcon :name="command.icon" /><span>{{ t(command.label) }}</span></button>
                </template>
              </div>
            </template>
          </div>
          <div class="rb-caption" aria-hidden="true">{{ t(group.label) }}</div>
        </div>
        </div>
      </div>
      <button v-show="overflow.right" class="rb-scroll" type="button" tabindex="-1" aria-hidden="true" @click="scrollBody(1)"><AppIcon name="chevronRight" /></button>
      <button class="rb-scroll rb-collapse" type="button" :aria-label="t('ribbonCollapse')" :title="t('ribbonCollapse')" @click="studio.toggleRibbon"><AppIcon name="chevronUp" /></button>
    </div>
  </section>
</template>

<style scoped>
.ribbon { flex: none; background: var(--ide-ribbon); border-bottom: 1px solid var(--ide-border-strong); }
.ribbon-tabs { display: flex; gap: 2px; padding: 0 8px; overflow-x: auto; scrollbar-width: none; background: var(--ide-ribbon); border-bottom: 1px solid var(--ide-border); }
.ribbon-tab { flex: none; height: 30px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #b0b0b0; font-size: 13px; cursor: pointer; }
.ribbon-tab:hover { color: #fff; background: var(--ide-hover); }
.ribbon-tab[aria-selected="true"] { color: #fff; border-bottom-color: #fff; }
.ribbon-row { display: flex; align-items: stretch; height: 92px; background: var(--ide-ribbon); }
.ribbon-body { flex: 1; min-width: 0; padding: 4px 6px 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.ribbon-groups { display: flex; align-items: stretch; width: max-content; height: 100%; }
.rb-scroll { flex: none; width: 24px; display: grid; place-items: center; align-self: stretch; border: 0; background: transparent; color: #b0b0b0; cursor: pointer; }
.rb-scroll:hover { color: #fff; background: var(--ide-hover); }
.rb-collapse { align-self: flex-end; height: 24px; }
.rb-group { flex: none; display: flex; flex-direction: column; padding: 0 8px; border-right: 1px solid var(--ide-border-strong); }
.rb-group:last-child { border-right: 0; }
.rb-commands { flex: 1; display: flex; align-items: flex-start; gap: 2px; min-height: 0; }
.rb-caption { height: 18px; line-height: 18px; text-align: center; color: #8c8c8c; font-size: 11px; white-space: nowrap; }
.rb-stack { display: flex; flex-direction: column; gap: 0; justify-content: flex-start; }
.rb-btn { min-height: 0; margin: 0; display: flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 3px; background: transparent; color: #d4d4d4; cursor: pointer; white-space: nowrap; }
.rb-btn:hover:not(:disabled) { background: var(--ide-hover); border-color: var(--ide-border-strong); }
.rb-btn:active:not(:disabled) { background: var(--ide-active); }
.rb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rb-btn[aria-pressed="true"] { background: var(--ide-active); border-color: #8a8a8a; }
.rb-large { flex-direction: column; justify-content: center; gap: 4px; min-width: 56px; height: 66px; padding: 4px 8px; font-size: 12px; }
.rb-small { height: 22px; padding: 0 8px; font-size: 12px; }
.rb-number { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; font-size: 12px; color: #d4d4d4; white-space: nowrap; }
.rb-number input { width: 64px; height: 20px; padding: 0 4px; border: 1px solid var(--ide-border-strong); border-radius: 2px; background: #1e1e1e; color: #fff; font: 12px var(--ide-mono); }
.rb-btn:focus-visible, .rb-scroll:focus-visible, .ribbon-tab:focus-visible, .rb-number input:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
</style>
