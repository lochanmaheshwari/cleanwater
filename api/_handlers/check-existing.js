import { createClient } from '@supabase/supabase-js';
const URL_ = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTQ5MzgsImV4cCI6MjEwMzIzMDkzOH0.8ap4RqKw5AH3ldyKAtWCnUIBmpH1lLANOcs8cK8xjV8';
export default async function handler(req,res){
  const dest=req.query.destination;
  if(!dest) return res.status(200).json({exists:false});
  const sb=createClient(URL_, KEY);
  const {data}=await sb.from('entries').select('id, destination, display_name, description, logo_path, total_bid_cents').eq('destination', dest).maybeSingle();
  if(data) return res.status(200).json({exists:true, entry:data});
  return res.status(200).json({exists:false});
}
