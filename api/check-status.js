import { createClient } from '@supabase/supabase-js';
const URL_ = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
export default async function handler(req,res){
  const id=(req.query.id||'').toString();
  if(!id) return res.status(400).json({error:'missing id'});
  const sb=createClient(URL_, KEY);
  const {data:entry} = await sb.from('entries').select('id, status, bid_cents, donation_cents, total_bid_cents, display_name, destination, category, logo_path').eq('id', id).single();
  if(!entry) return res.status(404).json({error:'not found'});
  return res.status(200).json({status: entry.status, entry});
}
