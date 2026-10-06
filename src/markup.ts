export const MARKERS = {
  start: "<start>",
  end: "<end>",
  pause: '<pause seconds="0.5"/>',
  clip: '<clip id="a"/>',
} as const;

export const SCOPES = {
  stutter: { open: '<stutter repeats="3">', close: "</stutter>" },
  pitch: { open: '<pitch value="1.2">', close: "</pitch>" },
  volume: { open: '<volume value="0.7">', close: "</volume>" },
  offset: { open: '<offset seconds="0.1">', close: "</offset>" },
  duration: { open: '<duration seconds="0.3">', close: "</duration>" },
  spacing: { open: '<spacing seconds="0.2">', close: "</spacing>" },
  rate: { open: '<rate value="1.2">', close: "</rate>" },
  sync: { open: "<sync>", close: "</sync>" },
} as const;

export const FIT_RANGE = { min: 0.05, max: 120, step: 0.05, default: 2 } as const;

export function fitScope(seconds: number) {
  return { open: `<fit seconds="${seconds}">`, close: "</fit>" };
}

export type MarkerName = keyof typeof MARKERS;
export type ScopeName = keyof typeof SCOPES;
export const MARKER_NAMES = Object.keys(MARKERS) as MarkerName[];
export const SCOPE_NAMES = Object.keys(SCOPES) as ScopeName[];
