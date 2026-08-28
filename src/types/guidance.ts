interface GuidanceBatchBase {
  jobId: string;
  scopePath: string;
  total: number;
  current: number;
  created: number;
  updated: number;
  skippedCurrent: number;
  failed: number;
  remaining: number;
  errors: Array<{ filePath: string; error: string }>;
}

export type DigestStatus = 'current' | 'stale' | 'failed' | 'missing';

export type GuidanceBatchState =
  | (GuidanceBatchBase & { status: 'running'; currentFilePath: string })
  | (GuidanceBatchBase & { status: 'completed'; currentFilePath: null });

export type StartGuidanceBatchResult =
  | { success: true; job: GuidanceBatchState }
  | { success: false; error: string; job?: GuidanceBatchState };
