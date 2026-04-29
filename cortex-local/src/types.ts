export interface IngestPayload {
  title: string;
  started_at: string;
  ended_at: string;
  attendees: string[];
  transcript: string;
  source: 'meetily';
  external_id?: string;
}
export interface QueuedItem {
  filePath: string;
  payload: IngestPayload;
  enqueuedAt: string;
  attempts: number;
}
export interface HeartbeatState {
  lastHeartbeatAt: string;
}
export interface PersistedRuntimeState {
  lastIngestAt: string | null;
  lastError: string | null;
}
