import axios from 'axios';

/** Axios instance pointed at the server (via Vite's /api dev proxy). */
export const api = axios.create({ baseURL: '/api' });

export interface HealthResponse {
  ok: boolean;
  service: string;
  time: string;
}

export interface RunBriefResponse {
  ok: boolean;
  status: 'success' | 'partial' | 'failed';
  itemCount: number;
  errors: string[];
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}

export async function runBriefNow(): Promise<RunBriefResponse> {
  const { data } = await api.post<RunBriefResponse>('/brief/run');
  return data;
}
