import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';

let tok=null,exp=0;
async function getToken(){
  if(tok && Date.now()<exp-60000) return tok;
  const id=process.env.PAYPAL_CLIENT_ID, sec=process.env.PAYPAL_SECRET;
  if(!id||!sec) throw new Error('no paypal creds');
  const r=await fetch(`${PAYPAL_BASE}/v1/oauth2/token`,{method:'POST',headers:{'Authorization':'Basic '+Buffer.from(id+':'+sec).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const j=await r.json(); tok=j.access_token; exp=Date.now()+j.expires_in*1000; return tok;
}

export default async function handler(req,res){
  // allow GET for manual trigger + POST for cron; protect with CRON_SECRET if set
  const secret=process.env.CRON_SECRET;
  if(secret){
    const got=req.headers['x-cron-secret']||req.query.secret;
    if(got!==secret) return res.status(401).json({error:'unauthorized cron'});
  }
  const sb=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const cutoff=new Date(Date.now()-30*60*1000).toISOString();
  const { data: olds, error } = await sb.from('entries').select('id, paypal_capture_id, logo_path, paid_at').eq('status','paid').lt('paid_at', cutoff).limit(20);
  if(error) return res.status(500).json({error:error.message});
  if(!olds || olds.length===0) return res.status(200).json({ok:true, voided:0});

  let voided=0, failed=0;
  for(const e of olds){
    try{
      if(e.paypal_capture_id && process.env.PAYPAL_CLIENT_ID){
        const t=await getToken();
        const r=await fetch(`${PAYPAL_BASE}/v2/payments/captures/${e.paypal_capture_id}/refund`,{method:'POST',headers:{'Authorization':`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({})});
        const j=await r.json();
        if(!r.ok) throw new Error(JSON.stringify(j));
      }
      await sb.from('entries').update({status:'voided'}).eq('id', e.id);
      // delete logo
      if(e.logo_path){
        try{ await sb.storage.from('logos').remove([e.logo_path]); }catch{}
      }
      voided++;
      // TODO: email user (needs email field; log for now)
      console.log(`voided ${e.id}, refunded capture ${e.paypal_capture_id}`);
    }catch(e){
      console.error('refund failed', e.message);
      await sb.from('entries').update({status:'refund_failed'}).eq('id', e.id);
      failed++;
    }
  }
  return res.status(200).json({ok:true, voided, failed});
}
