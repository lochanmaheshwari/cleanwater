import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = req.body || {};
    const entryId = body.entryId || body.entry_id || body.custom_id || body.metadata?.entryId;
    const paymentId = body.paymentId || body.payment_id || body.id || body.orderId || ('pay_' + Date.now());
    const amountCents = parseInt(body.amount_cents || body.amountCents || (body.bidDollars ? body.bidDollars * 100 : 0) || 500, 10);

    if (!entryId) return res.status(400).json({ error: 'missing entryId' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry, error: findErr } = await supabase.from('entries').select('*').eq('id', entryId).maybeSingle();
    if (findErr) throw findErr;
    if (!entry) return res.status(404).json({ error: 'entry not found' });

    const currentTotal = entry.total_bid_cents || 0;
    const newTotal = currentTotal > 0 ? currentTotal + amountCents : amountCents;
    const donatedCents = Math.round(newTotal * 0.75);

    // Update entry status to live
    const { error: updErr } = await supabase.from('entries').update({
      payment_confirmed: true,
      donation_confirmed: true,
      payment_id: String(paymentId),
      total_bid_cents: newTotal,
      donated_cents: donatedCents,
      status: 'live',
      last_bid_at: new Date().toISOString()
    }).eq('id', entryId);

    if (updErr) throw updErr;

    // Record bid in bids table
    try {
      await supabase.from('bids').insert({
        entry_id: entryId,
        amount_cents: amountCents,
        donated_cents: Math.round(amountCents * 0.75),
        payment_id: String(paymentId)
      });
    } catch (bidErr) {
      console.warn('could not insert bid row', bidErr);
    }

    return res.status(200).json({ ok: true, entryId, status: 'live', total_bid_cents: newTotal });
  } catch (e) {
    console.error('payment-done error', e);
    return res.status(500).json({ error: e.message });
  }
}
