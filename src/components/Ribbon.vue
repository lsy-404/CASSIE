<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { t } from "../i18n";
import { RIBBON_TABS, type ButtonCommand, type NumberCommand, type RibbonCommand, type RibbonGroup } from "../ribbon";
import { boundedNumber } from "../editor";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";

const studio = useStudio();
const tabList = ref<HTMLElement | null>(null);
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

function asButton(command: RibbonCommand): ButtonCommand { return command as ButtonCommand; }
function enabled(command: RibbonCommand) { return command.enabled ? command.enabled(studio) : true; }
function pressed(command: ButtonCommand) { return command.pressed ? command.pressed(studio) : undefined; }
function tip(command: RibbonCommand) { return t(command.tip ?? command.label); }

function selectTab(id: string) {
  if (id === studio.ribbonTab) return;
  studio.ribbonTab = id;
  studio.ribbonCollapsed = false;
}
function toggleCollapsed() { studio.ribbonCollapsed = !studio.ribbonCollapsed; }
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
        aria-controls="ribbon-body"
        :tabindex="studio.ribbonTab === tab.id ? 0 : -1"
        :title="studio.ribbonTab === tab.id ? t('ribbonDoubleClick') : undefined"
        @click="selectTab(tab.id)"
        @dblclick="studio.ribbonTab === tab.id && toggleCollapsed()"
      >{{ t(tab.label) }}</button>
    </div>
    <div v-if="!studio.ribbonCollapsed" id="ribbon-body" class="ribbon-body" role="tabpanel" :aria-labelledby="`ribbon-tab-${activeTab.id}`">
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
                  :aria-pressed="pressed(asButton(command))"
                  :title="tip(command)"
                  @click="studio.run(asButton(command).action)"
                ><AppIcon :name="command.icon" /><span>{{ t(command.label) }}</span></button>
              </template>
            </div>
          </template>
        </div>
        <div class="rb-caption" aria-hidden="true">{{ t(group.label) }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ribbon { flex: none; background: var(--ide-ribbon); border-bottom: 1px solid var(--ide-border-strong); }
.ribbon-tabs { display: flex; gap: 2px; padding: 0 8px; overflow-x: auto; scrollbar-width: none; background: var(--ide-ribbon); border-bottom: 1px solid var(--ide-border); }
.ribbon-tab { flex: none; height: 30px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #b0b0b0; font-size: 13px; cursor: pointer; }
.ribbon-tab:hover { color: #fff; background: var(--ide-hover); }
.ribbon-tab[aria-selected="true"] { color: #fff; border-bottom-color: #fff; }
.ribbon-body { display: flex; align-items: stretch; height: 92px; padding: 4px 6px 0; overflow-x: auto; overflow-y: hidden; background: var(--ide-ribbon); }
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
.rb-btn:focus-visible, .ribbon-tab:focus-visible, .rb-number input:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
</style>
