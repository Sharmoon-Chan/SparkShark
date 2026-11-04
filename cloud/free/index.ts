import { fontAssetResponse } from '../src/font-assets';
import type { FreeEnv } from './state';
export { MyResumeState } from './state';
export type { FreeEnv } from './state';

export default {
  async fetch(request: Request, env: FreeEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/')) {
      // Forward the original stream/headers intact. Never hash passwords or parse API bodies here.
      return env.STATE.getByName('myresume-global').fetch(request);
    }
    if (env.ASSETS && path.startsWith('/fonts/')) {
      const font = await fontAssetResponse(request, env.ASSETS);
      if (font) return font;
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Static build not available', { status: 404 });
  },
} satisfies ExportedHandler<FreeEnv>;
