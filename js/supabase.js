import { CONFIG } from './config.js';

let client = null;

export async function getSupabase() {
  if (client) return client;
  try {
    const mod = await import('https://esm.sh/@supabase/supabase-js@2.43.4');
    client = mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return client;
  } catch (e) {
    console.warn('Failed to load Supabase SDK from CDN', e);
    throw e;
  }
}

export async function safeQuery(fn) {
  try {
    const res = await fn();
    if (res.error) throw res.error;
    return res;
  } catch (e) {
    console.warn('supabase query failed', e);
    throw e;
  }
}
