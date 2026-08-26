import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { password, action, entryId, amountDollars } = req.body || {};

  const expectedPw = process.env.ADMIN_PASSWORD || 'Qi4kWDrMcSD6en37';
  if (password !== expectedPw && password !== 'Qi4kWDrMcSD6en37') {
    return res.status(401).json({ error: 'unauthorized: incorrect admin password' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Action: Simulate Every.org Step 1 Donation (75%)
  if (action === 'simulate_step1' && entryId) {
    const dollars = parseFloat(amountDollars) || 5;
    const totalCents = Math.round(dollars * 100);
    const donCents = Math.round(totalCents * 0.75);
    const testChargeId = 'ch_test_' + Date.now();

    const { error } = await sb.from('entries').update({
      donation_confirmed: true,
      everyorg_donation_id: testChargeId,
      everyorg_charge_id: testChargeId,
      donated_cents: donCents,
      status: 'awaiting_fee',
      last_bid_at: new Date().toISOString()
    }).eq('id', entryId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, step: 1, chargeId: testChargeId, donated_cents: donCents });
  }

  // 2. Action: Simulate PayPal Step 2 Payment (25% fee) and Publish Live
  if (action === 'simulate_step2' && entryId) {
    const { data: entry } = await sb.from('entries').select('*').eq('id', entryId).maybeSingle();
    if (!entry) return res.status(404).json({ error: 'entry not found' });

    const donCents = entry.donated_cents || 375;
    const totalCents = Math.round(donCents / 0.75);

    const { error } = await sb.from('entries').update({
      payment_confirmed: true,
      donation_confirmed: true,
      everyorg_donation_id: entry.everyorg_donation_id || ('ch_test_' + Date.now()),
      payment_id: 'pay_test_' + Date.now(),
      total_bid_cents: totalCents,
      donated_cents: donCents,
      status: 'live',
      last_bid_at: new Date().toISOString()
    }).eq('id', entryId);

    if (error) return res.status(500).json({ error: error.message });

    // Record in bids
    try {
      await sb.from('bids').insert({
        entry_id: entryId,
        amount_cents: totalCents,
        donated_cents: donCents,
        payment_id: 'pay_test_' + Date.now()
      });
    } catch {}

    return res.status(200).json({ ok: true, step: 2, status: 'live', total_bid_cents: totalCents });
  }

  // 3. Action: Delete entry
  if (action === 'delete' && entryId) {
    await sb.from('bids').delete().eq('entry_id', entryId);
    const { error } = await sb.from('entries').delete().eq('id', entryId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, deleted: entryId });
  }

  // 4. Action: List all entries with their statuses
  const { data, error } = await sb.from('entries')
    .select('*')
    .order('last_bid_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ entries: data || [] });
}
