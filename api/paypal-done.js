import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';

let token=null,exp=0;
async function getToken(){
  if(token && Date.now()<exp-60000) return token;
  const id=process.env.PAYPAL_CLIENT_ID, sec=process.env.PAYPAL_SECRET;
  if(!id||!sec) throw new Error('no paypal creds');
  const r=await fetch(`${PAYPAL_BASE}/v1/oauth2/token`,{method:'POST',headers:{'Authorization':'Basic '+Buffer.from(id+':'+sec).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const j=await r.json(); token=j.access_token; exp=Date.now()+j.expires_in*1000; return token;
}

export default async function handler(req,res){
  // PayPal sends POST with headers: paypal-transmission-id, paypal-transmission-time, paypal-cert-url, paypal-auth-algo, paypal-transmission-sig
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  const sb=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // verify signature if webhook id configured
  const whId=process.env.PAYPAL_WEBHOOK_ID;
  if(whId && process.env.PAYPAL_CLIENT_ID){
    try{
      const tok=await getToken();
      const body=req.body;
      const verifyBody={
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_time: req.headers['paypal-transmission-time'],
        cert_url: req.headers['paypal-cert-url'],
        auth_algo: req.headers['paypal-auth-algo'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        webhook_id: whId,
        webhook_event: body
      };
      const vr=await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify(verifyBody)});
      const vj=await vr.json();
      if(vj.verification_status!=='SUCCESS'){
        console.warn('paypal webhook verify failed', vj);
        return res.status(400).json({error:'signature verify failed'});
      }
    }catch(e){
      console.warn('verify error', e);
      // don't fail if verify service down? spec says reject, so return 400
      return res.status(400).json({error:'verify error'});
    }
  } else {
    console.warn('PAYPAL_WEBHOOK_ID not set — skipping signature verify (dev mode)');
  }

  const event=req.body;
  const type=event.event_type;
  // we handle both CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED
  let orderId=null, captureId=null, customId=null;
  if(event.resource){
    orderId=event.resource.id || event.resource.supplementary_data?.related_ids?.order_id;
    // custom_id is in purchase_units
    customId=event.resource.custom_id || event.resource.purchase_units?.[0]?.custom_id || event.resource.supplementary_data?.related_ids?.order_id;
    captureId=event.resource.id; // for capture completed, id is capture id
    if(event.resource.purchase_units) customId=event.resource.purchase_units[0]?.custom_id || customId;
  }
  // fallback: try to find entry by paypal_order_id
  let entry=null;
  if(customId){
    const {data}=await sb.from('entries').select('id, status, paypal_order_id').eq('id', customId).maybeSingle();
    entry=data;
  }
  if(!entry && orderId){
    const {data}=await sb.from('entries').select('id, status, paypal_order_id').eq('paypal_order_id', orderId).maybeSingle();
    entry=data;
  }
  if(!entry){
    console.warn('paypal webhook no entry for', type, event);
    return res.status(200).json({ok:true, note:'no entry'});
  }
  // idempotent: if already paid/live, do nothing
  if(entry.status==='paid' || entry.status==='live'){
    return res.status(200).json({ok:true, note:'already paid/live'});
  }

  // if CHECKOUT.ORDER.APPROVED, capture
  if(type==='CHECKOUT.ORDER.APPROVED' && orderId){
    try{
      const tok=await getToken();
      const cr=await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'}});
      const cj=await cr.json();
      if(!cr.ok) throw new Error(JSON.stringify(cj));
      const cap=cj.purchase_units?.[0]?.payments?.captures?.[0];
      captureId=cap?.id || captureId;
      console.log('captured', captureId);
    }catch(e){
      console.error('capture failed', e);
      return res.status(200).json({ok:true, note:'capture failed, will retry'});
    }
  }

  // update to paid
  const upd={ status:'paid', paid_at: new Date().toISOString() };
  if(captureId) upd.paypal_capture_id=captureId;
  // ensure we don't overwrite if already live
  const {error}=await sb.from('entries').update(upd).eq('id', entry.id).eq('status','pending');
  if(error) console.warn('update to paid error', error);

  return res.status(200).json({ok:true});
}
