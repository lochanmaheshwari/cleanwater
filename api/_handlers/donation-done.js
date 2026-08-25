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

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry, error: entryErr } = await sb.from('entries').select('*').eq('id', partnerId).maybeSingle();
    if (!entry) {
      console.warn('no entry for partnerId', partnerId, entryErr);
      return res.status(200).json({ ok: true, note: 'no entry' });
    }

    const paid = amtStr ? Math.round(parseFloat(amtStr) * 100) : null;
    const requiredDonation = entry.donated_cents || Math.round((entry.total_bid_cents || 1000) * 0.75);

    // Record donation confirmation
    const updateObj = {
      everyorg_charge_id: charge || partnerId + ':' + Date.now(),
      donated_at: new Date().toISOString(),
      donation_confirmed: true,
      donated_cents: (entry.donated_cents || 0) + (paid || requiredDonation)
    };

    if (entry.payment_confirmed || entry.status === 'paid') {
      updateObj.status = 'live';
      updateObj.logo_status = 'live';
      updateObj.total_bid_cents = (entry.total_bid_cents || 0) + Math.round((paid || requiredDonation) / 0.75);
    } else {
      updateObj.status = 'awaiting_fee';
    }

    const { data: updated, error } = await sb.from('entries').update(updateObj).eq('id', partnerId).select('id');
    if (error) console.warn('update entry error', error);

    // create bids row for accounting
    try {
      await sb.from('bids').insert({
        entry_id: partnerId,
        amount_cents: Math.round((paid || requiredDonation) / 0.75),
        donated_cents: paid || requiredDonation,
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
