<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { checkStartupCapabilities, type StartupStep } from '../startup/capabilities';
import { cellPath, glyphPath, GLYPH_HEIGHT, GLYPH_WIDTH, textCells, textPath } from '../startup/pixel-font';

const SPINNER = ['\\', '|', '/', '-'];
const SPINNER_MS = 80;
const DOT_MS = 70;
const LEADER_DOTS = 160;
const TICK_MS = 35;
const HANDOFF_MS = 700;
const WORDMARK = 'CASSIE+';
const GLYPH_STRIDE = 8;
const FRAME_GAP = 2;
const RING = FRAME_GAP + 1;
const CELLS_WIDE = (WORDMARK.length - 1) * GLYPH_STRIDE + GLYPH_WIDTH;
const GRID_WIDE = CELLS_WIDE + RING * 2;
const GRID_HIGH = GLYPH_HEIGHT + RING * 2;
const CAPTION = [`CASSIE+  V${__APP_VERSION__}`.toUpperCase(), 'INDEPENDENT PROJECT'];

const wordmarkPath = (() => {
  const cells: string[] = [];
  for (let x = 0; x < GRID_WIDE; x += 1) cells.push(cellPath(x, 0), cellPath(x, GRID_HIGH - 1));
  for (let y = 1; y < GRID_HIGH - 1; y += 1) cells.push(cellPath(0, y), cellPath(GRID_WIDE - 1, y));
  [...WORDMARK].forEach((char, index) => {
    const left = RING + index * GLYPH_STRIDE;
    cells.push(glyphPath(char, left, RING));
    if (index < WORDMARK.length - 1) cells.push(cellPath(left + GLYPH_WIDTH + 1, RING + GLYPH_HEIGHT - 1));
  });
  return cells.join('');
})();

const captionLines = CAPTION.map((text) => ({ text, path: textPath(text), cells: textCells(text) }));

const steps = ref<StartupStep[]>([]);
const checking = ref(true);
const entered = ref(false);
const failed = ref(false);
const now = ref(performance.now());
const log = ref<HTMLElement>();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const failedStep = computed(() => steps.value.find((step) => step.status === 'fail'));
const startedAt = new Map<string, number>();
const marker = (step: StartupStep) => step.status === 'ok' ? '[ OK ]' : step.status === 'fail' ? '[FAIL]' : `[ ${reducedMotion ? '-' : SPINNER[Math.floor(now.value / SPINNER_MS) % SPINNER.length]}  ]`;
const result = (step: StartupStep) => step.status === 'ok' ? 'OK' : step.status === 'fail' ? 'FAIL' : '';
const leader = (step: StartupStep) => {
  if (step.status !== 'pending' || reducedMotion) return '.'.repeat(LEADER_DOTS);
  const dots = Math.floor((now.value - (startedAt.get(step.id) ?? now.value)) / DOT_MS);
  return '.'.repeat(Math.min(LEADER_DOTS, Math.max(0, dots)));
};
let controller: AbortController | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;

function record(step: StartupStep): void {
  const index = steps.value.findIndex((item) => item.id === step.id);
  if (index < 0) {
    startedAt.set(step.id, performance.now());
    steps.value.push(step);
  } else steps.value[index] = step;
}

watch(steps, () => nextTick(() => {
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}), { deep: true });

onMounted(async () => {
  if (!reducedMotion) ticker = setInterval(() => { now.value = performance.now(); }, TICK_MS);
  controller = new AbortController();
  const { signal } = controller;
  try {
    await checkStartupCapabilities(signal, record);
  } catch {
    if (signal.aborted) return;
    checking.value = false;
    failed.value = true;
    clearInterval(ticker);
    return;
  }
  checking.value = false;
  await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : HANDOFF_MS));
  if (signal.aborted) return;
  clearInterval(ticker);
  entered.value = true;
});

onBeforeUnmount(() => {
  controller?.abort();
  clearInterval(ticker);
});
</script>

<template>
  <main v-if="!entered" class="terminal-entry" lang="en">
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
      </h1>
      <p class="terminal-entry__subtitle">CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES</p>
      <div ref="log" class="terminal-entry__log" data-testid="terminal-log">
        <div v-for="step in steps" :key="step.id" class="terminal-entry__step" :data-status="step.status" data-testid="terminal-step">
          <div class="terminal-entry__line">
            <span class="terminal-entry__marker">{{ marker(step) }}</span>
            <span class="terminal-entry__label">{{ step.label }}</span>
            <span class="terminal-entry__leader" aria-hidden="true">{{ leader(step) }}</span>
            <span class="terminal-entry__result">{{ result(step) }}</span>
          </div>
          <div v-if="step.detail" class="terminal-entry__detail">{{ step.detail }}</div>
        </div>
        <span class="terminal-entry__cursor" aria-hidden="true" />
      </div>
      <p class="terminal-entry__status" :class="{ 'terminal-entry__status--ready': !checking }" role="status" data-testid="terminal-status">
        {{ checking ? 'RUNNING STARTUP CHECKS' : 'SYSTEM READY' }}
      </p>
    </section>
    <footer class="terminal-entry__caption" role="img" data-testid="terminal-caption" :aria-label="CAPTION.join('  ')">
      <svg
        v-for="line in captionLines"
        :key="line.text"
        :viewBox="`0 0 ${line.cells} ${GLYPH_HEIGHT}`"
        :width="line.cells"
        :height="GLYPH_HEIGHT"
        shape-rendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <path :d="line.path" fill="currentColor" />
      </svg>
    </footer>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 12px;
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
  margin-block: auto;
}

.terminal-entry__wordmark {
  width: min(100%, 520px);
  margin: 0;
  color: #fff;
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

.terminal-entry__caption {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
  align-self: flex-start;
  margin-top: 16px;
  color: #5c5c5c;
}

.terminal-entry__caption svg {
  display: block;
  flex: none;
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

.terminal-entry__message {
  z-index: 1;
  margin-block: auto;
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
