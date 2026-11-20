import { api } from './client.js';
import { unwrap } from './errors.js';

/** `GET /health`: resolves while the API is up, rejects otherwise. */
export async function fetchApiHealth(signal?: AbortSignal) {
  return unwrap(await api.GET('/health', { signal }));
}
