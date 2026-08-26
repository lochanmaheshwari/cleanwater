import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UROPAY_WEBHOOK_SECRET = process.env.UROPAY_WEBHOOK_SECRET;

export const config = { api: { bodyParser: false } };

function verifySignature(rawBody, signature) {
  if (!UROPAY_WEBHOOK_SECRET || !signature) return true; // if no secret configured, accept (but log)
  const expected = crypto.createHmac('sha256', UROPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  // UroPay may send hex or base64, try both
  try {
    const a = Buffer.from(signature, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length === b.length && crypto.timingSafeEqual(a,b)) return true;
  } catch {}
  // also try base64
  try {
    const sigHex = Buffer.from(signature,'base64').toString('hex');
    if (sigHex === expected) return true;
  } catch {}
  return signature === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  // read raw body for signature check (Vercel may already parse, handle both)
  let raw = '';
  let body = req.body;
  if (!body || typeof body === 'string') {
    raw = body || '';
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  } else {
    raw = JSON.stringify(body);
  }
  // Vercel bodyParser may have already consumed stream, fallback: if raw empty, use body
  if (!raw && body) raw = JSON.stringify(body);
  const sig = req.headers['x-webhook-signature'] || req.headers['x-uropay-signature'] || req.headers['x-signature'] || req.headers['signature'] || '';

  if (UROPAY_WEBHOOK_SECRET && sig && !verifySignature(raw, String(sig))) {
    console.warn('uropay webhook bad signature', sig);
    // don't block in prod if sandbox, but log — return 401 to let UroPay retry
    return res.status(401).json({ error: 'invalid signature' });
  }

  try {
    const p = body || {};
    // UroPay payload variants
    const entryId = p.partnerOrderId || p.order_id || p.orderId || p.metadata?.entryId || p.data?.partnerOrderId || p.data?.order_id;
    const statusRaw = (p.status || p.payment_status || p.order_status || p.data?.status || '').toString().toLowerCase();
    const isSuccess = ['success','paid','completed','captured','confirmed','payment.success','order.completed'].includes(statusRaw) || p.success === true || p.data?.success === true;
    const utr = p.utr || p.upi_ref || p.reference || p.txnId || p.transaction_id || p.data?.utr || '';
    const amount = p.amount || p.amount_in_paise ? (p.amount_in_paise/100) : (p.data?.amount || null);
    const orderId = p.order_id || p.id || p.data?.id || entryId;

    if (!entryId) {
      console.warn('uropay webhook no entryId', p);
      return res.status(200).json({ ok: true, ignored: 'no entryId' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry } = await sb.from('entries').select('*').eq('id', entryId).maybeSingle();
    if (!entry) {
      console.warn('uropay webhook entry not found', entryId);
      return res.status(200).json({ ok: true, ignored: 'entry not found' });
    }

    if (!isSuccess) {
      // store attempt but don't mark live
      try { await sb.from('entries').update({ uropay_last_status: statusRaw || 'pending', uropay_utr: utr ? String(utr) : null }).eq('id', entryId); } catch {}
      return res.status(200).json({ ok: true, status: statusRaw || 'pending' });
    }

    // Success -> mark live like payment-done does, but for UPI full amount (75% water + 25% fee already bundled)
    // Use bid_cents stored on entry, fallback to computed from amount INR->USD if missing
    let totalBidCents = entry.bid_cents || entry.total_bid_cents || 0;
    if (!totalBidCents || totalBidCents < 100) {
      // try to derive from UroPay amount (INR) -> USD
      if (amount) {
        const inr = Number(amount);
        totalBidCents = Math.round((inr / 83.5) * 100);
      } else totalBidCents = 500;
    }
    const donatedCents = Math.floor(totalBidCents * 0.75);
    // Update entry to live
    const upd = {
      payment_confirmed: true,
      donation_confirmed: true,
      status: 'live',
      total_bid_cents: totalBidCents,
      donated_cents: donatedCents,
      uropay_order_id: String(orderId),
      uropay_utr: utr ? String(utr) : null,
      uropay_last_status: 'success',
      payment_id: String(utr || orderId || 'uropay_'+Date.now()),
      last_bid_at: new Date().toISOString(),
    };
    try { upd.everyorg_donation_id = `uropay:${String(utr || orderId)}`; } catch {}
    const { error: updErr } = await sb.from('entries').update(upd).eq('id', entryId);
    if (updErr) throw updErr;

    // insert bid row for stats
    try {
      await sb.from('bids').insert({
        entry_id: entryId,
        amount_cents: totalBidCents,
        donated_cents: donatedCents,
        payment_id: String(utr || orderId),
        everyorg_donation_id: `uropay:${String(utr || orderId)}`,
      });
    } catch (e) { console.warn('uropay bid insert', e.message); }

    return res.status(200).json({ ok: true, entryId, status: 'live' });
  } catch (e) {
    console.error('uropay-webhook error', e);
    return res.status(500).json({ error: e.message });
  }
}
