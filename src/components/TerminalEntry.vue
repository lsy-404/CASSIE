<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FluentButton, FluentTheme } from '@platform-kit/fluent/vue';
import { checkStartupCapabilities } from '../startup/capabilities';

const props = withDefaults(defineProps<{ locale?: 'zh' | 'en' }>(), { locale: 'zh' });
const emit = defineEmits<{
  ready: [];
  unlocked: [];
  error: [error: Error];
}>();

const checking = ref(true);
const unlocking = ref(false);
const unlocked = ref(false);
const failed = ref(false);
let controller: AbortController | undefined;

const copy = () => props.locale === 'zh'
  ? {
      subtitle: 'CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES',
      checking: '正在检查音频能力…',
      unlock: 'TAP TO UNLOCK',
      failure: 'CASSIE 无法在您的设备上加载。CASSIE 需要完整支持所需能力的标准 Chromium 浏览器。',
    }
  : {
      subtitle: 'CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES',
      checking: 'Checking audio capabilities…',
      unlock: 'TAP TO UNLOCK',
      failure: 'CASSIE could not load on this device. CASSIE requires a standard Chromium browser with full support for the required capabilities.',
    };

async function unlock(): Promise<void> {
  if (checking.value || unlocking.value || failed.value || unlocked.value) return;
  unlocking.value = true;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const resumed = context.resume();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        resumed,
        new Promise<never>((_, reject) => {
          timeout = globalThis.setTimeout(() => reject(new Error('Audio unlock timed out.')), 10_000);
        }),
      ]);
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
    }
    if (context.state !== 'running') throw new Error('Audio could not be unlocked.');
    unlocked.value = true;
    emit('unlocked');
  } catch (error) {
    failed.value = true;
    emit('error', error instanceof Error ? error : new Error('Audio unlock failed.'));
  } finally {
    await context?.close().catch(() => undefined);
    unlocking.value = false;
  }
}

onMounted(async () => {
  controller = new AbortController();
  try {
    await checkStartupCapabilities(controller.signal);
    checking.value = false;
    emit('ready');
  } catch (error) {
    if (controller.signal.aborted) return;
    checking.value = false;
    failed.value = true;
    emit('error', error instanceof Error ? error : new Error('Capability check failed.'));
  }
});

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <FluentTheme v-if="!unlocked" mode="dark">
    <main class="terminal-entry" :lang="props.locale === 'zh' ? 'zh-CN' : 'en'">
      <section v-if="failed" class="terminal-entry__message" role="alert" data-testid="terminal-error">
        {{ copy().failure }}
      </section>
      <section v-else class="terminal-entry__card" aria-label="CASSIE Terminal">
        <div class="terminal-entry__wordmark">
          <h1>C.A.S.S.I.E.</h1>
          <span>TERMINAL</span>
        </div>
        <p class="terminal-entry__subtitle">{{ copy().subtitle }}</p>
        <p v-if="checking || unlocking" class="terminal-entry__status" role="status">{{ checking ? copy().checking : (props.locale === 'zh' ? '正在开启音频…' : 'Unlocking audio…') }}</p>
        <FluentButton
          class="terminal-entry__unlock"
          data-testid="terminal-unlock"
          :disabled="checking || unlocking"
          @click="unlock"
        >
          {{ copy().unlock }}
        </FluentButton>
      </section>
    </main>
  </FluentTheme>
  <slot v-else />
</template>

<style scoped>
.terminal-entry {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #000;
  color: #fff;
  text-align: center;
}

.terminal-entry__card {
  display: flex;
  max-width: min(100%, 520px);
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.terminal-entry__wordmark {
  border: 1px solid currentColor;
  padding: 18px 28px;
  display: grid;
  gap: 6px;
}

.terminal-entry__wordmark h1 {
  margin: 0;
  font-size: clamp(1.55rem, 6vw, 2.25rem);
  font-weight: 500;
  letter-spacing: 0.34em;
  line-height: 1.2;
  text-indent: 0.34em;
}

.terminal-entry__wordmark span {
  font-size: 0.62rem;
  letter-spacing: 0.38em;
  text-indent: 0.38em;
}

.terminal-entry__subtitle {
  max-width: 42ch;
  margin: 0;
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  line-height: 1.6;
}

.terminal-entry__status {
  margin: 22px 0 0;
}

.terminal-entry__unlock {
  margin-top: 18px;
  letter-spacing: 0.18em;
}

.terminal-entry__message {
  max-width: 46rem;
  line-height: 1.7;
}

@media (prefers-reduced-motion: no-preference) {
  .terminal-entry__unlock {
    transition: opacity 140ms ease;
  }
}
</style>
