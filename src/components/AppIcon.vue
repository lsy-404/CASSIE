<script setup lang="ts">
import { ICONS, type IconName } from "../icons";

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 });
</script>

<template>
  <svg class="app-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-for="path in ICONS[name]" :key="path" :d="path" />
  </svg>
</template>

<style scoped>
.app-icon { flex: none; }
</style>
