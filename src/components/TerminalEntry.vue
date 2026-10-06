<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { checkStartupCapabilities, type StartupStep } from '../startup/capabilities';
import { cellPath, glyphPath, GLYPH_HEIGHT, GLYPH_WIDTH, textCells, textPath } from '../startup/pixel-font';

const SPINNER = ['\\', '|', '/', '-'];
const SPINNER_MS = 80;
const DOT_MS = 100;
// Columns taken by the tag plus marker margin and by the spinner plus its margin (see the marker and spinner CSS).
const TAG_COLS = 7;
const SPINNER_COLS = 2;
const PROBE_CHARS = 10;
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
const failure = ref<string>();
const now = ref(performance.now());
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const failedStep = computed(() => steps.value.find((step) => step.status === 'fail'));
const errorLines = computed(() => failure.value === undefined ? [] : [
  `step: ${failedStep.value?.label ?? 'startup'}`,
  ...(failedStep.value?.detail ? [] : [`reason: ${failure.value}`]),
  `environment: ${navigator.userAgent}`,
  'startup halted',
]);
const startedAt = new Map<string, number>();
const frozenDots = new Map<string, number>();
const log = ref<HTMLElement>();
const probe = ref<HTMLElement>();
const columns = ref(0);
const tag = (step: StartupStep) => step.status === 'ok' ? '[ OK ]' : step.status === 'fail' ? '[FAIL]' : '[PEND]';
const spinner = () => reducedMotion ? '-' : SPINNER[Math.floor(now.value / SPINNER_MS) % SPINNER.length];
const dotCap = (step: StartupStep) => Math.max(0, Math.floor((columns.value - TAG_COLS - step.label.length - SPINNER_COLS) / 2));
const grownDots = (step: StartupStep, at: number) => reducedMotion ? 0 : Math.max(0, Math.floor((at - (startedAt.get(step.id) ?? at)) / DOT_MS));
const dots = (step: StartupStep) => ' .'.repeat(Math.min(dotCap(step), step.status === 'pending' ? grownDots(step, now.value) : frozenDots.get(step.id) ?? 0));
const measure = () => {
  const cell = (probe.value?.getBoundingClientRect().width ?? 0) / PROBE_CHARS;
  const style = log.value && getComputedStyle(log.value);
  if (!cell || !log.value || !style) return;
  columns.value = Math.floor((log.value.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / cell);
};
let resizer: ResizeObserver | undefined;
let controller: AbortController | undefined;
let frame = 0;

const tick = (time: number) => {
  now.value = time;
  frame = requestAnimationFrame(tick);
};

function stopClock(): void {
  cancelAnimationFrame(frame);
  resizer?.disconnect();
}

function record(step: StartupStep): void {
  const index = steps.value.findIndex((item) => item.id === step.id);
  if (index < 0) {
    startedAt.set(step.id, performance.now());
    steps.value.push(step);
  } else {
    if (step.status !== 'pending' && steps.value[index].status === 'pending') frozenDots.set(step.id, Math.min(dotCap(step), grownDots(step, performance.now())));
    steps.value[index] = step;
  }
}

watch([steps, failure], () => nextTick(() => {
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}), { deep: true });

onMounted(async () => {
  measure();
  if (log.value && typeof ResizeObserver !== 'undefined') {
    resizer = new ResizeObserver(measure);
    resizer.observe(log.value);
  }
  if (!reducedMotion) frame = requestAnimationFrame(tick);
  controller = new AbortController();
  const { signal } = controller;
  try {
    await checkStartupCapabilities(signal, record);
  } catch (error) {
    if (signal.aborted) return;
    checking.value = false;
    failure.value = error instanceof Error ? error.message : 'unknown error';
    stopClock();
    return;
  }
  checking.value = false;
  await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : HANDOFF_MS));
  if (signal.aborted) return;
  stopClock();
  entered.value = true;
});

onBeforeUnmount(() => {
  controller?.abort();
  stopClock();
});
</script>

<template>
  <main v-if="!entered" class="terminal-entry" lang="en">
    <div class="terminal-entry__scanlines" data-testid="terminal-scanlines" aria-hidden="true" />
    <section class="terminal-entry__card" aria-label="CASSIE PLUS Terminal">
      <h1 class="terminal-entry__wordmark" aria-label="C.A.S.S.I.E.+">
        <svg :viewBox="`0 0 ${GRID_WIDE} ${GRID_HIGH}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
          <path :d="wordmarkPath" fill="currentColor" />
        </svg>
      </h1>
      <p class="terminal-entry__subtitle">CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES</p>
      <div ref="log" class="terminal-entry__log" data-testid="terminal-log">
        <div v-for="step in steps" :key="step.id" class="terminal-entry__step" :data-status="step.status" data-testid="terminal-step">
          <div class="terminal-entry__line">
            <span class="terminal-entry__marker">{{ tag(step) }}</span>
            <span class="terminal-entry__label">{{ step.label }}</span>
            <span class="terminal-entry__dots" aria-hidden="true">{{ dots(step) }}</span>
            <span v-if="step.status === 'pending'" class="terminal-entry__spinner" aria-hidden="true">{{ spinner() }}</span>
          </div>
          <div v-if="step.detail" class="terminal-entry__detail">{{ step.detail }}</div>
        </div>
        <span ref="probe" class="terminal-entry__probe" aria-hidden="true">{{ '0'.repeat(PROBE_CHARS) }}</span>
        <div v-if="errorLines.length" class="terminal-entry__error" role="alert" data-testid="terminal-error">
          <div v-for="line in errorLines" :key="line">[ERROR] {{ line }}</div>
        </div>
        <span v-else class="terminal-entry__cursor" aria-hidden="true" />
      </div>
      <p class="terminal-entry__status" :class="{ 'terminal-entry__status--ready': !checking && !errorLines.length, 'terminal-entry__status--halted': errorLines.length > 0 }" role="status" data-testid="terminal-status">
        {{ errorLines.length ? 'STARTUP HALTED' : checking ? 'RUNNING STARTUP CHECKS' : 'SYSTEM READY' }}
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
  --pend: #facc15;
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
  position: relative;
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
  white-space: pre;
}

.terminal-entry__marker {
  flex: none;
  margin-right: 1ch;
  color: #fff;
}

.terminal-entry__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-entry__dots {
  flex: none;
  color: #666;
}

.terminal-entry__spinner {
  flex: none;
  margin-left: 1ch;
  color: #fff;
}

.terminal-entry__probe {
  position: absolute;
  visibility: hidden;
  white-space: pre;
}

.terminal-entry__detail {
  padding-left: 4ch;
  color: #8a8a8a;
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

[data-status='pending'] .terminal-entry__marker {
  color: var(--pend);
}

[data-status='ok'] .terminal-entry__marker,
.terminal-entry__status--ready {
  color: var(--ok);
}

[data-status='fail'] .terminal-entry__marker,
.terminal-entry__status--halted,
.terminal-entry__error {
  color: var(--fail);
}

.terminal-entry__error {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

@media (prefers-reduced-motion: reduce) {
  .terminal-entry__scanlines::after {
    display: none;
  }

  .terminal-entry__cursor {
    animation: none;
  }
}
</style>
