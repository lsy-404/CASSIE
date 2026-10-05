<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FluentTheme } from '@platform-kit/fluent/vue';
import { setLocale } from '../i18n';
import { checkStartupCapabilities, startupStepIds, type StartupStepId } from '../startup/capabilities';

const props = withDefaults(defineProps<{ locale?: 'zh' | 'en' }>(), { locale: 'zh' });
const emit = defineEmits<{
  ready: [];
  unlocked: [];
  error: [error: Error];
}>();

type LineKey = StartupStepId | 'session' | 'running' | 'passed' | 'awaiting' | 'unlocking';
interface LogLine { id: string; tag: 'run' | 'ok' | 'fail' | 'info'; key: LineKey }

const LINE_DELAY_MS = 30;
const FULL_NAME = 'CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES';
const TAGS = { run: '[....]', ok: '[ OK ]', fail: '[FAIL]', info: '[INFO]' } as const;

// 5x7 bitmap glyphs; X marks a lit cell
const GLYPHS: Record<string, string[]> = {
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
};
const WORD = 'CASSIE';
const wordmarkWidth = WORD.length * 6 - 1;
const wordmarkPath = [...WORD].flatMap((letter, index) =>
  GLYPHS[letter].flatMap((row, y) =>
    [...row].flatMap((cell, x) => (cell === 'X' ? [`M${index * 6 + x} ${y}h1v1h-1z`] : []))),
).join('');

const checking = ref(true);
const unlocking = ref(false);
const unlocked = ref(false);
const failed = ref(false);
const lines = ref<LogLine[]>([]);
const doneSteps = ref(0);
const logElement = ref<HTMLElement>();
let controller: AbortController | undefined;
let queue: Promise<void> = Promise.resolve();

const copies = {
  zh: {
    labels: {
      workers: 'Web Worker 线程', wasm: 'WebAssembly 运行时', webaudio: 'Web Audio 音频上下文', core: '类型化数组 / 文本编解码 / 结构化克隆',
      streams: '解压缩流', crypto: '加密摘要', blob: '对象 URL', engine: 'Opus 解码器与 WORLD 声码器', phonemizer: '音素化发音引擎',
      session: '本地终端会话已建立', running: '正在运行启动自检', passed: '全部自检通过', awaiting: '需要用户操作以解锁音频', unlocking: '正在开启音频上下文',
    } satisfies Record<LineKey, string>,
    title: 'CASSIE 终端',
    log: '启动日志',
    state: { checking: '自检中', ready: '系统就绪', awaiting: '等待输入', unlocking: '正在开启音频' },
    unlock: 'TAP TO UNLOCK',
    switchTo: '切换为英文',
    switchLabel: 'EN',
    failure: 'CASSIE 无法在您的设备上加载。CASSIE 需要完整支持所需能力的标准 Chromium 浏览器。',
  },
  en: {
    labels: {
      workers: 'web workers', wasm: 'webassembly runtime', webaudio: 'web audio context', core: 'typed arrays / text codecs / structured clone',
      streams: 'decompression streams', crypto: 'crypto digest', blob: 'object urls', engine: 'opus decoder + world vocoder', phonemizer: 'phonemizer pronunciation engine',
      session: 'local terminal session established', running: 'running startup self-check', passed: 'all checks passed', awaiting: 'user action required to unlock audio', unlocking: 'opening audio context',
    } satisfies Record<LineKey, string>,
    title: 'CASSIE Terminal',
    log: 'Startup log',
    state: { checking: 'CHECKING', ready: 'SYSTEM READY', awaiting: 'AWAITING INPUT', unlocking: 'UNLOCKING AUDIO' },
    unlock: 'TAP TO UNLOCK',
    switchTo: 'Switch language to Chinese',
    switchLabel: '中文',
    failure: 'CASSIE could not load on this device. CASSIE requires a standard Chromium browser with full support for the required capabilities.',
  },
};
const copy = computed(() => copies[props.locale]);

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function enqueue(apply: () => void): void {
  queue = queue.then(async () => {
    if (controller?.signal.aborted) return;
    apply();
    if (!reducedMotion) await new Promise((resolve) => globalThis.setTimeout(resolve, LINE_DELAY_MS));
  });
}

function pushInfo(key: LineKey): void {
  lines.value.push({ id: key, tag: 'info', key });
}

function record(id: StartupStepId, state: 'run' | 'ok' | 'fail'): void {
  enqueue(() => {
    const existing = lines.value.find((line) => line.id === id);
    if (existing) existing.tag = state;
    else lines.value.push({ id, tag: state, key: id });
    if (state === 'ok') doneSteps.value += 1;
  });
}

const progressCells = 24;
const progressBar = computed(() => {
  const filled = Math.round((doneSteps.value / startupStepIds.length) * progressCells);
  return '█'.repeat(filled) + '░'.repeat(progressCells - filled);
});
const stateText = computed(() => {
  if (unlocking.value) return copy.value.state.unlocking;
  if (checking.value) return copy.value.state.checking;
  return `${copy.value.state.ready} · ${copy.value.state.awaiting}`;
});

watch(() => lines.value.length, async () => {
  await nextTick();
  if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight;
});

function toggleLocale(): void {
  setLocale(props.locale === 'zh' ? 'en' : 'zh');
}

async function unlock(): Promise<void> {
  if (checking.value || unlocking.value || failed.value || unlocked.value) return;
  unlocking.value = true;
  pushInfo('unlocking');
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
  enqueue(() => pushInfo('session'));
  enqueue(() => pushInfo('running'));
  try {
    await checkStartupCapabilities(controller.signal, ({ id, state }) => record(id, state));
    enqueue(() => pushInfo('passed'));
    enqueue(() => pushInfo('awaiting'));
    await queue;
    if (controller.signal.aborted) return;
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
      <button type="button" class="terminal-entry__lang" :aria-label="copy.switchTo" data-testid="terminal-locale" @click="toggleLocale">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M4.5 7.5h15M4.5 16.5h15" />
        </svg>
        <span>{{ copy.switchLabel }}</span>
      </button>
      <section v-if="failed" class="terminal-entry__message" role="alert" data-testid="terminal-error">
        {{ copy.failure }}
      </section>
      <section v-else class="terminal-entry__screen" :aria-label="copy.title">
        <header class="terminal-entry__head">
          <svg
            class="terminal-entry__wordmark"
            :viewBox="`-1 -1 ${wordmarkWidth + 2} 9`"
            shape-rendering="crispEdges"
            role="img"
            aria-label="CASSIE"
          >
            <path :d="wordmarkPath" fill="currentColor" />
          </svg>
          <p class="terminal-entry__name">{{ FULL_NAME }}</p>
        </header>
        <div ref="logElement" class="terminal-entry__log" role="log" aria-live="polite" :aria-label="copy.log" tabindex="0">
          <p v-for="line in lines" :key="line.id" class="terminal-entry__line" :data-tag="line.tag">
            <span class="terminal-entry__tag">{{ TAGS[line.tag] }}</span> {{ copy.labels[line.key] }}
          </p>
          <p class="terminal-entry__line"><span class="terminal-entry__cursor" aria-hidden="true">█</span></p>
        </div>
        <div class="terminal-entry__status" role="status">
          <span class="terminal-entry__spinner" :data-busy="checking || unlocking" aria-hidden="true" />
          <span class="terminal-entry__bar" aria-hidden="true">{{ progressBar }}</span>
          <span class="terminal-entry__state">{{ stateText }}</span>
        </div>
        <button
          type="button"
          class="terminal-entry__unlock"
          data-testid="terminal-unlock"
          :disabled="checking || unlocking"
          @click="unlock"
        >
          <span aria-hidden="true">&gt;</span> {{ copy.unlock }}
        </button>
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
  padding: 16px;
  overflow: hidden;
  background: #050505;
  color: #f2f2f2;
  font: 13px/1.5 ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Microsoft YaHei", "PingFang SC", monospace;
}

.terminal-entry__lang {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid #555;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.terminal-entry__lang:hover,
.terminal-entry__lang:focus-visible {
  border-color: #fff;
  outline: none;
}

.terminal-entry__screen {
  display: grid;
  width: min(100%, 760px);
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  gap: 14px;
  padding-top: 40px;
}

.terminal-entry__head {
  display: grid;
  justify-items: center;
  gap: 16px;
}

.terminal-entry__wordmark {
  width: min(100%, 520px);
  height: auto;
}

.terminal-entry__name {
  margin: 0;
  padding: 6px 12px;
  border: 1px solid #f2f2f2;
  font-size: clamp(9px, 2.4vw, 12px);
  letter-spacing: 0.12em;
  text-align: center;
}

.terminal-entry__log {
  overflow-y: auto;
  padding: 8px 2px;
  border-top: 1px solid #333;
  border-bottom: 1px solid #333;
  color: #bdbdbd;
  overflow-wrap: anywhere;
}

.terminal-entry__line {
  margin: 0;
}

.terminal-entry__tag {
  color: #8a8a8a;
}

.terminal-entry__line[data-tag="ok"] .terminal-entry__tag {
  color: #fff;
  font-weight: 700;
}

.terminal-entry__line[data-tag="fail"] .terminal-entry__tag {
  background: #fff;
  color: #000;
  font-weight: 700;
}

.terminal-entry__status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
}

.terminal-entry__spinner::before {
  content: "▪";
}

.terminal-entry__bar {
  letter-spacing: 0;
  color: #fff;
}

.terminal-entry__state {
  letter-spacing: 0.14em;
}

.terminal-entry__unlock {
  justify-self: start;
  padding: 8px 14px;
  border: 1px solid #f2f2f2;
  background: transparent;
  color: #f2f2f2;
  font: inherit;
  letter-spacing: 0.18em;
  cursor: pointer;
}

.terminal-entry__unlock:hover:not(:disabled),
.terminal-entry__unlock:focus-visible {
  background: #f2f2f2;
  color: #000;
  outline: none;
}

.terminal-entry__unlock:disabled {
  border-color: #444;
  color: #666;
  cursor: default;
}

.terminal-entry__message {
  max-width: 46rem;
  line-height: 1.7;
  text-align: center;
}

@media (prefers-reduced-motion: no-preference) {
  .terminal-entry__cursor {
    animation: terminal-blink 1s steps(1) infinite;
  }

  .terminal-entry__spinner[data-busy="true"]::before {
    content: "▖";
    animation: terminal-spin 0.4s steps(1) infinite;
  }
}

@keyframes terminal-blink {
  50% { opacity: 0; }
}

@keyframes terminal-spin {
  0% { content: "▖"; }
  25% { content: "▘"; }
  50% { content: "▝"; }
  75% { content: "▗"; }
}
</style>
