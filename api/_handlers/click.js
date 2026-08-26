import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const id = (req.body?.id || req.body?.entryId || req.query?.id || req.query?.entryId || '').toString();
  if (!id) return res.status(400).json({ error: 'missing id' });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Fetch current clicks
    const { data: entry } = await sb.from('entries').select('id, click_count').eq('id', id).maybeSingle();
    if (!entry) return res.status(404).json({ error: 'entry not found' });

    const newCount = (entry.click_count || 0) + 1;
    await sb.from('entries').update({ click_count: newCount }).eq('id', id);

    // Record in clicks table for audit
    try {
      await sb.from('clicks').insert({ entry_id: id });
    } catch {}

    return res.status(200).json({ ok: true, id, click_count: newCount });
  } catch (err) {
    console.error('click increment error', err);
    return res.status(500).json({ error: err.message });
  }
}
