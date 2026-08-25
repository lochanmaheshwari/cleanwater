import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  console.log('donation webhook', JSON.stringify(req.body).slice(0,2000));
  try{
    const { chargeId, partnerDonationId, amount, netAmount } = req.body || {};
    const charge = chargeId || req.body.chargeId || req.body.id;
    const partnerId = partnerDonationId || req.body.partnerDonationId || req.body.partner_donation_id;
    const amtStr = amount || req.body.amount;

    if(!partnerId) return res.status(200).json({ok:true, note:'no partnerDonationId'});

    const sb=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry } = await sb.from('entries').select('id, donation_cents, status, total_bid_cents, bid_cents, donated_cents').eq('id', partnerId).single();
    if(!entry) {
      console.warn('no entry for partnerId', partnerId);
      return res.status(200).json({ok:true, note:'no entry'});
    }

    const paid = amtStr ? Math.round(parseFloat(amtStr)*100) : null;
    if(paid !== null && paid < entry.donation_cents){
      await sb.from('entries').update({ status:'needs_review' }).eq('id', partnerId);
      console.warn('paid less than required', paid, entry.donation_cents);
      return res.status(200).json({ok:true, note:'underpaid flagged'});
    }

    // Record donation confirmation
    const updateObj = {
      everyorg_charge_id: charge || partnerId + ':' + Date.now(),
      donated_at: new Date().toISOString(),
      donation_confirmed: true,
      donated_cents: (entry.donated_cents || 0) + (entry.donation_cents || Math.round((entry.bid_cents || 500) * 0.75))
    };

    if (entry.payment_confirmed || entry.status === 'paid') {
      updateObj.status = 'live';
      updateObj.logo_status = 'live';
      updateObj.total_bid_cents = (entry.total_bid_cents || 0) + (entry.bid_cents || 500);
    } else {
      updateObj.status = 'awaiting_fee';
    }

    const { data: updated, error } = await sb.from('entries').update(updateObj).eq('id', partnerId).select('id');
    if (error) console.warn('update entry error', error);

    // create bids row for accounting
    try {
      await sb.from('bids').insert({
        entry_id: partnerId,
        amount_cents: entry.bid_cents || 500,
        donated_cents: entry.donation_cents || Math.round((entry.bid_cents || 500) * 0.75),
        everyorg_donation_id: charge || partnerId
      });
    } catch (e) {
      console.warn('bids insert', e.message);
    }

    return res.status(200).json({ok:true});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message});
  }
}
