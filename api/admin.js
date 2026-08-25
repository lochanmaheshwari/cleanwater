import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { password, action, entryId } = req.body || {};

  const expectedPw = process.env.ADMIN_PASSWORD || 'admin123';
  if (password !== expectedPw) return res.status(401).json({ error: 'unauthorized' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (action === 'approve' || entryId) {
    if (!entryId) return res.status(400).json({ error: 'missing entryId' });
    const { error } = await sb.from('entries').update({
      status: 'live',
      payment_confirmed: true,
      last_bid_at: new Date().toISOString()
    }).eq('id', entryId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, status: 'live' });
  }

  // default: list pending
  const { data, error } = await sb.from('entries')
    .select('*')
    .eq('donation_confirmed', true)
    .eq('payment_confirmed', false)
    .order('last_bid_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ entries: data || [] });
}
