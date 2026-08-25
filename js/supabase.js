import { CONFIG } from './config.js';
let client=null;
export async function getSupabase(){
  if(client) return client;
  // load via CDN ESM
  const mod = await import('https://esm.sh/@supabase/supabase-js@2.43.4');
  client = mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return client;
}
export async function safeQuery(fn){
  try{
    const res = await fn();
    if(res.error) throw res.error;
    return res;
  }catch(e){
    // return null to allow graceful fallback
    console.warn('supabase query failed',e);
    throw e;
  }
}
