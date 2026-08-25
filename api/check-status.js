import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req, res) {
  const id = (req.query.id || req.query.entryId || '').toString();
  if (!id) return res.status(400).json({ error: 'missing id' });
  try {
    const sb = createClient(URL_, KEY);
    let { data: entry, error } = await sb.from('entries').select('*').eq('id', id).maybeSingle();
    if (!entry) {
      const r2 = await sb.from('entries').select('*').eq('slug', id).maybeSingle();
      entry = r2.data;
    }
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    return res.status(200).json({ status: entry.status, entry });
  } catch (e) {
    console.error('check-status error', e);
    return res.status(500).json({ error: e.message });
  }
}
