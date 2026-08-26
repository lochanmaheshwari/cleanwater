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

    // If donation not yet confirmed in database, query Every.org Partner API in real-time
    if (!entry.donation_confirmed || !entry.everyorg_donation_id) {
      const apiKey = process.env.EVERYORG_PRIVATE_KEY || process.env.EVERYORG_PUBLIC_KEY || 'pk_live_3770bf44947f5c510bdd88838874707e';
      try {
        const checkRes = await fetch(`https://partners.every.org/v0.2/partner/donations?partnerDonationId=${encodeURIComponent(entry.id)}&apiKey=${encodeURIComponent(apiKey)}`);
        const checkData = await checkRes.json().catch(() => ({}));
        const donations = checkData.donations || (Array.isArray(checkData) ? checkData : (checkData.donation ? [checkData.donation] : []));
        const matched = donations.find(d => d.partnerDonationId === entry.id || d.id);
        
        if (matched && matched.id) {
          const chargeId = matched.chargeId || matched.id;
          const donCents = matched.amount ? Math.round(parseFloat(matched.amount) * 100) : (entry.donated_cents || 375);
          
          await sb.from('entries').update({
            donation_confirmed: true,
            everyorg_donation_id: String(chargeId),
            donated_cents: donCents,
            status: entry.status === 'live' ? 'live' : 'awaiting_fee',
            last_bid_at: new Date().toISOString()
          }).eq('id', entry.id);

          entry.donation_confirmed = true;
          entry.everyorg_donation_id = String(chargeId);
          entry.donated_cents = donCents;
          entry.status = entry.status === 'live' ? 'live' : 'awaiting_fee';
        }
      } catch (err) {
        console.warn('Every.org auto-sync check error in check-status', err);
      }
    }

    return res.status(200).json({ status: entry.status, entry });
  } catch (e) {
    console.error('check-status error', e);
    return res.status(500).json({ error: e.message });
  }
}
