import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL=process.env.SUPABASE_URL||'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  const {password, entryId}=req.body||{};
  if(!process.env.ADMIN_PASSWORD){ if(password!=='admin123') return res.status(401).json({error:'unauthorized'}); }
  else if(password!==process.env.ADMIN_PASSWORD) return res.status(401).json({error:'unauthorized'});
  if(!entryId) return res.status(400).json({error:'missing entryId'});
  const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY);
  await sb.from('entries').update({payment_confirmed:true, status:'live'}).eq('id',entryId);
  return res.status(200).json({ok:true});
}
