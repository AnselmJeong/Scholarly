export interface GuidanceReadResult {
  success: boolean;
  content?: string;
  status?: 'current' | 'stale' | 'failed' | 'missing';
  error?: string;
}

/** Opening an existing digest must remain a read-only action. Generation is
 * reserved for sources that do not have a readable digest file. */
export function shouldGenerateGuidanceForOpen(result: GuidanceReadResult): boolean {
  return !result.success;
}
