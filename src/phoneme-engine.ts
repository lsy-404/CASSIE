import { ref } from 'vue';

/** Why the phoneme engine is unusable on this device; set by the startup check, undefined while it works. */
export const phonemeEngineError = ref<string>();
