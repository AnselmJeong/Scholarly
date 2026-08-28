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
  phase: 'queued' | 'extracting' | 'generating' | 'extracting_evidence' | 'merging_evidence' | 'retrying_request' | 'validating' | 'repairing' | 'publishing' | 'cancelling' | 'idle';
  detail: string;
  stopReason: string | null;
}

export type DigestStatus = 'current' | 'stale' | 'failed' | 'missing';

export type GuidanceBatchState = GuidanceBatchBase & {
  status: 'running' | 'cancelling' | 'completed' | 'cancelled' | 'stopped';
  currentFilePath: string | null;
};

export type StartGuidanceBatchResult =
  | { success: true; job: GuidanceBatchState }
  | { success: false; error: string; job?: GuidanceBatchState };
