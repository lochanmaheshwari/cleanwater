import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL=process.env.SUPABASE_URL||'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const PAYMENT_WEBHOOK_SECRET=process.env.PAYMENT_WEBHOOK_SECRET||'';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  console.log('payment webhook', JSON.stringify(req.body));
  try{
    const body=req.body||{};
    // support stripe-like or generic: entryId, paymentId, amount
    const entryId=body.entryId||body.entry_id||body.metadata?.entryId||body.data?.object?.metadata?.entryId;
    const paymentId=body.paymentId||body.payment_id||body.id||body.data?.object?.id;
    const amount_cents=body.amount_cents||body.amount||body.data?.object?.amount;
    // optional secret check
    const sig=req.headers['x-webhook-secret']||req.query.secret;
    if(PAYMENT_WEBHOOK_SECRET && sig && sig!==PAYMENT_WEBHOOK_SECRET){
      console.warn('payment webhook secret mismatch');
    }
    if(!entryId) return res.status(400).json({error:'missing entryId'});

    const supabase=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const {data:entry, error}=await supabase.from('entries').select('*').eq('id',entryId).maybeSingle();
    if(error) throw error;
    if(!entry) return res.status(404).json({error:'entry not found'});

    // if donation not yet confirmed but payment arrives first, mark payment and keep awaiting_donation
    const upd={
      payment_confirmed:true,
      payment_id: String(paymentId||'pay_'+Date.now()),
      status: entry.donation_confirmed ? 'live' : 'awaiting_donation'
    };
    await supabase.from('entries').update(upd).eq('id', entryId);
    // if donation amount already set via bids, total already updated; if not, we may need to add 25% part? but donation webhook will add 75%+total.
    // For manual approve flow, ensure live if donation confirmed:
    const {data:updated}=await supabase.from('entries').select('*').eq('id',entryId).single();
    if(updated.donation_confirmed && updated.payment_confirmed){
      await supabase.from('entries').update({status:'live'}).eq('id',entryId);
    }
    return res.status(200).json({ok:true});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message});
  }
}
