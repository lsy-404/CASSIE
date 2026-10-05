<script setup lang="ts">
import { ref, watch } from "vue";
import { FluentNumberField, FluentSlider } from "@platform-kit/fluent/vue";
import { boundedNumber } from "../editor";

const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
  step: number;
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

let draft: number | null = props.modelValue;
const revision = ref(0);

watch(() => props.modelValue, (value) => { draft = value; });

function capture(value: number | null): void {
  draft = value;
}

function commit(): void {
  const result = boundedNumber(draft, props.min, props.max);
  draft = result ?? props.modelValue;
  if (result !== undefined) emit("update:modelValue", result);
  revision.value += 1;
}

function updateSlider(value: number | string): void {
  const result = boundedNumber(Number(value), props.min, props.max);
  if (result === undefined) return;
  draft = result;
  emit("update:modelValue", result);
  revision.value += 1;
}
</script>

<template>
  <div class="fine-control">
    <FluentSlider :model-value="modelValue" :min="min" :max="max" :step="step" :aria-label="label" @update:model-value="updateSlider" />
    <FluentNumberField
      :key="revision"
      :model-value="modelValue"
      :label="label"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="label"
      @update:model-value="capture"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />
  </div>
</template>

<style scoped>
.fine-control { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 76px; align-items: center; gap: 10px; }
.fine-control :deep(.fluent-field) { display: block; }
.fine-control :deep(.fluent-field__label) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.fine-control :deep(.fluent-field__input) { min-height: 30px; padding: 4px 6px; border-radius: 2px; font: 11px ui-monospace, monospace; }
</style>
