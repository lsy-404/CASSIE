<script setup lang="ts">
import { FluentButton } from "@platform-kit/fluent/vue";
import { t } from "../i18n";
import { useStudio } from "../studio";

const studio = useStudio();
</script>

<template>
  <div class="phone-inventory">
    <h3>{{ t('inventory', { count: studio.phoneKeys.length }) }}</h3>
    <p v-if="studio.phoneIndexError" class="error">{{ studio.phoneIndexError }}</p>
    <div v-else class="phone-list">
      <FluentButton v-for="phone in studio.phoneKeys" :key="phone" tone="subtle" :disabled="!studio.bank || studio.encodingOpus" :aria-label="t('insertPhone', { phone })" :title="t('phoneTitle', { phone })" @click="studio.insertPhoneme(phone)">{{ phone }}</FluentButton>
    </div>
  </div>
</template>

<style scoped>
h3 { margin: 4px 0 10px; font-size: 12px; font-weight: 400; color: var(--fluent-muted); }
.phone-list { display: flex; flex-wrap: wrap; gap: 4px; }
.phone-list :deep(.fluent-button) { min-width: 34px; min-height: 28px; padding: 0 8px; font-family: var(--ide-mono); }
.error { color: var(--fluent-danger); font-size: 12px; }
</style>
