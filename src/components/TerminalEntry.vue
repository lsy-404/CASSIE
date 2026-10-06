<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { checkStartupCapabilities, type StartupStep } from '../startup/capabilities';

const SPINNER = ['\\', '|', '/', '-'];
const FONT: Record<string, string[]> = {
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
};
const LETTERS = 'CASSIE';
const FRAME_GAP = 2;
const GLYPH_STRIDE = 8;
const CELLS_WIDE = LETTERS.length * GLYPH_STRIDE - 1;
const CELLS_HIGH = 7;
const RING = FRAME_GAP + 1;
const GRID_WIDE = CELLS_WIDE + RING * 2;
const GRID_HIGH = CELLS_HIGH + RING * 2;

const wordmarkPath = (() => {
  const cells: string[] = [];
  const cell = (x: number, y: number) => cells.push(`M${x} ${y}h1v1h-1z`);
  for (let x = 0; x < GRID_WIDE; x += 1) {
    cell(x, 0);
    cell(x, GRID_HIGH - 1);
  }
  for (let y = 1; y < GRID_HIGH - 1; y += 1) {
    cell(0, y);
    cell(GRID_WIDE - 1, y);
  }
  [...LETTERS].forEach((letter, index) => {
    const left = RING + index * GLYPH_STRIDE;
    FONT[letter].forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel === 'X') cell(left + x, RING + y);
    }));
    cell(left + 6, RING + CELLS_HIGH - 1);
  });
  return cells.join('');
})();

const steps = ref<StartupStep[]>([]);
const checking = ref(true);
const unlocking = ref(false);
const unlocked = ref(false);
const failed = ref(false);
const frame = ref(0);
const log = ref<HTMLElement>();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const failedStep = computed(() => steps.value.find((step) => step.status === 'fail'));
const marker = (step: StartupStep) => step.status === 'ok' ? '[ OK ]' : step.status === 'fail' ? '[FAIL]' : `[ ${reducedMotion ? '-' : SPINNER[frame.value]}  ]`;
const result = (step: StartupStep) => step.status === 'ok' ? 'OK' : step.status === 'fail' ? 'FAIL' : '';
let controller: AbortController | undefined;
let spinner: ReturnType<typeof setInterval> | undefined;

function record(step: StartupStep): void {
  const index = steps.value.findIndex((item) => item.id === step.id);
  if (index < 0) steps.value.push(step);
  else steps.value[index] = step;
}

async function unlock(): Promise<void> {
  if (checking.value || unlocking.value || failed.value || unlocked.value) return;
  unlocking.value = true;
  let context: AudioContext | undefined;
  const unlockStep = { id: 'unlock', label: 'unlock audio output' };
  const started = performance.now();
  const timing = () => `${Math.round(performance.now() - started)} ms`;
  record({ ...unlockStep, detail: '', status: 'pending' });
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
    record({ ...unlockStep, detail: `${context.state} · ${timing()}`, status: 'ok' });
    unlocked.value = true;
  } catch (error) {
    failed.value = true;
    record({ ...unlockStep, detail: `${error instanceof Error ? error.message : 'Audio unlock failed.'} · ${context?.state ?? 'no context'} · ${timing()}`, status: 'fail' });
  } finally {
    await context?.close().catch(() => undefined);
    unlocking.value = false;
  }
}

watch(steps, () => nextTick(() => {
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}), { deep: true });

onMounted(async () => {
  if (!reducedMotion) spinner = setInterval(() => { frame.value = (frame.value + 1) % SPINNER.length; }, 80);
  controller = new AbortController();
  try {
    await checkStartupCapabilities(controller.signal, record);
    checking.value = false;
  } catch {
    if (controller.signal.aborted) return;
    checking.value = false;
    failed.value = true;
  }
});

onBeforeUnmount(() => {
  controller?.abort();
  clearInterval(spinner);
});
</script>

<template>
  <main v-if="!unlocked" class="terminal-entry" lang="en">
    <div class="terminal-entry__scanlines" data-testid="terminal-scanlines" aria-hidden="true" />
    <section v-if="failed" class="terminal-entry__message" role="alert" data-testid="terminal-error">
      <p v-if="failedStep" class="terminal-entry__fail-line">
        [FAIL] {{ failedStep.label }}<br>
        <span class="terminal-entry__detail">{{ failedStep.detail }}</span>
      </p>
      CASSIE PLUS could not load on this device. CASSIE PLUS requires a standard Chromium browser with full support for the required capabilities.
    </section>
    <section v-else class="terminal-entry__card" aria-label="CASSIE PLUS Terminal">
      <h1 class="terminal-entry__wordmark" aria-label="C.A.S.S.I.E.+">
        <svg :viewBox="`0 0 ${GRID_WIDE} ${GRID_HIGH}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
          <path :d="wordmarkPath" fill="currentColor" />
        </svg>
        <span class="terminal-entry__plus" aria-hidden="true">+</span>
      </h1>
      <p class="terminal-entry__subtitle">CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES</p>
      <div ref="log" class="terminal-entry__log" data-testid="terminal-log">
        <div v-for="step in steps" :key="step.id" class="terminal-entry__step" :data-status="step.status" data-testid="terminal-step">
          <div class="terminal-entry__line">
            <span class="terminal-entry__marker">{{ marker(step) }}</span>
            <span class="terminal-entry__label">{{ step.label }}</span>
            <span class="terminal-entry__leader" aria-hidden="true">{{ '.'.repeat(160) }}</span>
            <span class="terminal-entry__result">{{ result(step) }}</span>
          </div>
          <div v-if="step.detail" class="terminal-entry__detail">{{ step.detail }}</div>
        </div>
        <span class="terminal-entry__cursor" aria-hidden="true" />
      </div>
      <p class="terminal-entry__status" :class="{ 'terminal-entry__status--ready': !checking && !unlocking }" role="status" data-testid="terminal-status">
        {{ checking ? 'RUNNING STARTUP CHECKS' : unlocking ? 'UNLOCKING AUDIO' : 'SYSTEM READY' }}
      </p>
      <button
        class="terminal-entry__unlock"
        data-testid="terminal-unlock"
        type="button"
        :disabled="checking || unlocking"
        @click="unlock"
      >
        &gt; TAP TO UNLOCK
      </button>
    </section>
  </main>
  <slot v-else />
</template>

<style scoped>
.terminal-entry {
  --ok: #4ade80;
  --fail: #f87171;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  padding: 24px 16px;
  overflow: auto;
  background: #000;
  color: #e5e5e5;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

.terminal-entry__scanlines {
  position: fixed;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.045) 0 1px, transparent 1px 3px);
}

.terminal-entry__scanlines::after {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 22vh;
  background: linear-gradient(to bottom, transparent, rgb(255 255 255 / 0.05) 50%, transparent);
  animation: terminal-sweep 7s linear infinite;
}

@keyframes terminal-sweep {
  from { transform: translateY(-100%); }
  to { transform: translateY(460%); }
}

.terminal-entry__card {
  display: flex;
  width: min(100%, 640px);
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.terminal-entry__wordmark {
  width: min(100%, 520px);
  margin: 0;
  color: #fff;
}

.terminal-entry__plus {
  display: block;
  margin-top: 8px;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.6em;
  text-align: center;
  text-indent: 0.6em;
}

.terminal-entry__wordmark svg {
  display: block;
  width: 100%;
  height: auto;
}

.terminal-entry__subtitle {
  margin: 0;
  border: 1px solid currentColor;
  padding: 6px 10px;
  color: #fff;
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  line-height: 1.6;
  text-align: center;
}

.terminal-entry__log {
  width: 100%;
  height: min(46vh, 380px);
  overflow-y: auto;
  border: 1px solid #333;
  padding: 10px 12px;
  line-height: 1.5;
  text-align: left;
}

.terminal-entry__line {
  display: flex;
  gap: 0.6ch;
}

.terminal-entry__marker {
  flex: none;
  white-space: pre;
  color: #fff;
}

.terminal-entry__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.terminal-entry__leader {
  min-width: 2ch;
  flex: 1 1 0;
  overflow: hidden;
  color: #666;
  white-space: nowrap;
}

.terminal-entry__result {
  flex: none;
  min-width: 2ch;
  text-align: right;
}

.terminal-entry__detail {
  padding-left: 4ch;
  color: #8a8a8a;
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

[data-status='ok'] .terminal-entry__marker,
[data-status='ok'] .terminal-entry__result,
.terminal-entry__status--ready {
  color: var(--ok);
}

[data-status='fail'] .terminal-entry__marker,
[data-status='fail'] .terminal-entry__result,
.terminal-entry__fail-line {
  color: var(--fail);
}

.terminal-entry__cursor {
  display: inline-block;
  width: 0.6em;
  height: 1.1em;
  background: #e5e5e5;
  vertical-align: text-bottom;
  animation: terminal-blink 1s steps(1) infinite;
}

@keyframes terminal-blink {
  50% { opacity: 0; }
}

.terminal-entry__status {
  margin: 0;
  letter-spacing: 0.18em;
}

.terminal-entry__unlock {
  border: 1px solid currentColor;
  padding: 10px 18px;
  background: transparent;
  color: #fff;
  font: inherit;
  letter-spacing: 0.18em;
  cursor: pointer;
}

.terminal-entry__unlock:disabled {
  color: #666;
  cursor: default;
}

.terminal-entry__unlock:not(:disabled):hover,
.terminal-entry__unlock:not(:disabled):focus-visible {
  background: #fff;
  color: #000;
}

.terminal-entry__message {
  z-index: 1;
  width: min(100%, 46rem);
  line-height: 1.7;
  text-align: center;
}

.terminal-entry__fail-line {
  margin: 0 0 16px;
}

@media (prefers-reduced-motion: reduce) {
  .terminal-entry__scanlines::after {
    display: none;
  }

  .terminal-entry__cursor {
    animation: none;
  }
}
</style>
