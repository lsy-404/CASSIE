export type StagedError = Error & { stage?: string };

export const withStage = (reason: string, stage?: string): string => `${reason} (last stage: ${stage ?? 'never started'})`;
