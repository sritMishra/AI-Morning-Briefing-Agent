import axios from 'axios';

/** Axios instance pointed at the server (via Vite's /api dev proxy). */
export const api = axios.create({ baseURL: '/api' });

/**
 * Normalise errors ONCE here (not per-call). We still reject/throw — TanStack
 * Query needs that to populate `isError`/`error` — but with the server's actual
 * message (`{ error }`) instead of a generic "Request failed with status 500".
 */
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const serverMsg = (error.response?.data as { error?: string } | undefined)?.error;
    return Promise.reject(new Error(serverMsg ?? error.message ?? 'Request failed'));
  },
);

export interface HealthResponse {
  ok: boolean;
  service: string;
  time: string;
}

export interface PreviewItem {
  source: string;
  title: string;
  url?: string;
}

export interface RenderedBrief {
  subject: string;
  slack: string;
  html: string;
}

export interface RunBriefResponse {
  ok: boolean;
  status: 'success' | 'partial' | 'failed';
  itemCount: number;
  errors: string[];
  preview?: PreviewItem[];
  rendered?: RenderedBrief;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}

export async function runBriefNow(): Promise<RunBriefResponse> {
  const { data } = await api.post<RunBriefResponse>('/brief/run');
  return data;
}
