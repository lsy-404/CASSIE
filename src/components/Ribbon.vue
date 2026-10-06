<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { t } from "../i18n";
import { RIBBON_GROUPS, type ButtonCommand, type NumberCommand, type RibbonCommand, type RibbonGroup } from "../ribbon";
import { boundedNumber } from "../editor";
import { useStudio } from "../studio";
import AppIcon from "./AppIcon.vue";
import FineControl from "./FineControl.vue";

const studio = useStudio();
const body = ref<HTMLElement | null>(null);
const groupsEl = ref<HTMLElement | null>(null);
const overflow = ref({ left: false, right: false });

const MAX_STACK = 3;
type Item = { large: ButtonCommand } | { stack: RibbonCommand[] };

function layout(group: RibbonGroup): Item[] {
  const items: Item[] = [];
  let run: RibbonCommand[] = [];
  const flush = () => {
    const columns = Math.ceil(run.length / MAX_STACK);
    const size = Math.ceil(run.length / columns);
    for (let index = 0; index < run.length; index += size) items.push({ stack: run.slice(index, index + size) });
    run = [];
  };
  for (const command of group.commands) {
    if (command.kind !== "number" && command.kind !== "slider" && command.size === "large") { flush(); items.push({ large: command }); }
    else run.push(command);
  }
  flush();
  return items;
}
const layouts = new Map(RIBBON_GROUPS.map((group) => [group.id, layout(group)]));

function enabled(command: RibbonCommand) { return command.enabled ? command.enabled(studio) : true; }
function pressed(command: ButtonCommand) { return command.pressed ? command.pressed(studio) : undefined; }
function tip(command: RibbonCommand) { return t(command.tip ?? command.label); }

function measure() {
  const element = body.value;
  overflow.value = element
    ? { left: element.scrollLeft > 1, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 }
    : { left: false, right: false };
}
function scrollBody(direction: -1 | 1) { body.value?.scrollBy({ left: direction * 160, behavior: "smooth" }); }
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
    <button v-if="studio.ribbonCollapsed" id="ribbon-show" class="ribbon-show" type="button" :aria-label="t('ribbonExpand')" :title="t('ribbonExpand')" @click="studio.toggleRibbon"><AppIcon name="chevronDown" :size="14" /><span>{{ t('ribbonToggle') }}</span></button>
    <div v-else class="ribbon-row">
      <button :class="['rb-scroll', { idle: !overflow.left }]" type="button" tabindex="-1" :aria-label="t('ribbonScrollLeft')" @click="scrollBody(-1)"><AppIcon name="chevronLeft" /></button>
      <div id="ribbon-body" ref="body" class="ribbon-body" @scroll.passive="measure">
        <div ref="groupsEl" class="ribbon-groups">
          <div v-for="group in RIBBON_GROUPS" :key="group.id" class="rb-group" role="group" :aria-label="t(group.label)" :title="group.tip ? t(group.tip) : undefined">
            <div class="rb-commands">
              <template v-for="(item, index) in layouts.get(group.id)" :key="index">
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
                    <div v-else-if="command.kind === 'slider'" class="rb-slider" :data-command="command.id">
                      <AppIcon :name="command.icon" />
                      <span :title="tip(command)">{{ t(command.label) }}</span>
                      <FineControl v-model="studio[command.model]" class="compact" :min="command.min" :max="command.max" :step="command.step" :label="t(command.label)" />
                    </div>
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
      <button :class="['rb-scroll', { idle: !overflow.right }]" type="button" tabindex="-1" :aria-label="t('ribbonScrollRight')" @click="scrollBody(1)"><AppIcon name="chevronRight" /></button>
      <button class="rb-scroll rb-collapse" type="button" :aria-label="t('ribbonCollapse')" :title="t('ribbonCollapse')" @click="studio.toggleRibbon"><AppIcon name="chevronUp" /></button>
    </div>
  </section>
</template>

<style scoped>
.ribbon { flex: none; background: var(--ide-ribbon); border-bottom: 1px solid var(--ide-border-strong); }
.ribbon-show { width: 100%; height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 12px; border: 0; background: transparent; color: #b0b0b0; font-size: 12px; cursor: pointer; }
.ribbon-show:hover { color: #fff; background: var(--ide-hover); }
.ribbon-row { display: flex; align-items: stretch; background: var(--ide-ribbon); }
.ribbon-body { flex: 1; min-width: 0; padding: 2px 6px 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.ribbon-groups { display: flex; flex-wrap: nowrap; align-items: stretch; width: max-content; }
.rb-scroll { flex: none; width: 24px; display: grid; place-items: center; align-self: stretch; border: 0; background: transparent; color: #b0b0b0; cursor: pointer; }
.rb-scroll:hover { color: #fff; background: var(--ide-hover); }
.rb-collapse { align-self: flex-end; height: 24px; }
.rb-group { flex: none; height: 88px; display: flex; flex-direction: column; padding: 2px 8px 0; border-right: 1px solid var(--ide-border-strong); border-bottom: 1px solid var(--ide-border); }
.rb-commands { flex: 1; display: flex; align-items: flex-start; gap: 2px; min-height: 0; }
.rb-caption { height: 18px; line-height: 18px; text-align: center; color: #8c8c8c; font-size: 11px; white-space: nowrap; }
.rb-stack { display: flex; flex-direction: column; justify-content: flex-start; }
.rb-btn { min-height: 0; margin: 0; display: flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 3px; background: transparent; color: #d4d4d4; cursor: pointer; white-space: nowrap; }
.rb-btn:hover:not(:disabled) { background: var(--ide-hover); border-color: var(--ide-border-strong); }
.rb-btn:active:not(:disabled) { background: var(--ide-active); }
.rb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rb-btn[aria-pressed="true"] { background: var(--ide-active); border-color: #8a8a8a; }
.rb-large { flex-direction: column; justify-content: center; gap: 4px; min-width: 56px; height: 66px; padding: 4px 8px; font-size: 12px; }
.rb-small { height: 22px; padding: 0 8px; font-size: 12px; }
.rb-number, .rb-slider { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; font-size: 12px; color: #d4d4d4; white-space: nowrap; }
.rb-number input { width: 64px; height: 20px; min-height: 0; padding: 0 4px; border: 1px solid var(--ide-border-strong); border-radius: 2px; background: #1e1e1e; color: #fff; font: 12px var(--ide-mono); }
.rb-btn:focus-visible, .rb-scroll:focus-visible, .ribbon-show:focus-visible, .rb-number input:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.rb-scroll.idle { visibility: hidden; }
</style>
