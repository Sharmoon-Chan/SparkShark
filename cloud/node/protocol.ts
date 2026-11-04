export const MAX_NODE_BODY_BYTES = 8 * 1024 * 1024;

export function releaseTransferredBuffer(buffer: ArrayBuffer | null): void {
  if (!buffer?.byteLength) return;
  // Node 24 supports ArrayBuffer.transfer. After its consumer finishes, shrinking
  // to zero releases the large backing store without waiting for a low-pressure JS GC.
  const transferable = buffer as ArrayBuffer & { transfer(size: number): ArrayBuffer };
  transferable.transfer(0);
}
export interface ApiJob {
  type: 'request'; id: number; url: string; method: string;
  headers: [string, string][]; body: ArrayBuffer | null;
}
export interface ApiReply {
  type: 'response'; id: number; status: number; headers: [string, string][]; body: ArrayBuffer;
}
export interface ApiFailure { type: 'failure'; id: number; }
export interface WorkerConfiguration { filename: string; appOrigin: string; bootstrapToken?: string; }
