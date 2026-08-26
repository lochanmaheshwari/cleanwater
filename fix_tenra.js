import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const { data, error } = await sb.from('entries').update({
    total_bid_cents: 5000,
    donated_cents: 3750,
    status: 'live'
  }).eq('id', '1341a108-2487-4a0d-a6b7-b23d7c0af897');
  console.log('Fixed tenra:', error ? error : 'Success');
}
fix();
