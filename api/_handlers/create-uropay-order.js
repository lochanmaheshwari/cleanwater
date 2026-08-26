import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://savewater.tech');

// UroPay credentials from app.uropay.me/dashboard
const UROPAY_API_KEY = process.env.UROPAY_API_KEY;
const UROPAY_API_SECRET = process.env.UROPAY_API_SECRET;
const UROPAY_VPA = process.env.UROPAY_VPA;
const UROPAY_BASE = process.env.UROPAY_BASE || 'https://app.uropay.me/api';

function normalize(raw) {
  let s = (raw || '').trim();
  if (!s) throw new Error('enter url or handle');
  if (s.startsWith('@')) return '@' + s.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!s.includes('.') && !s.includes('/') && !s.includes(':') && /^[a-zA-Z0-9_]{1,15}$/.test(s)) return '@' + s.toLowerCase();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  const host = u.hostname.toLowerCase();
  if (host.includes('discord.gg') || (host.includes('discord.com') && u.pathname.includes('/invite'))) throw new Error('chat invite links not allowed');
  if (host.includes('t.me') || host.includes('telegram.me')) throw new Error('chat invite links not allowed');
  if (host.includes('chat.whatsapp.com')) throw new Error('chat invite links not allowed');
  const bare = host.replace(/^www\./, '');
  const block = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','buff.ly','shorturl.at','is.gd','rebrand.ly','cutt.ly'];
  if (block.includes(bare) || block.includes(host)) throw new Error('link shorteners not allowed');
  if (/(porn|xxx|sex|adult|nsfw)/i.test(u.href)) throw new Error('adult content not allowed');
  const TRACK = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','igshid'];
  for (const k of [...u.searchParams.keys()]) if (TRACK.includes(k.toLowerCase()) || k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  let h = u.hostname.toLowerCase().replace(/^www\./,'');
  u.hostname=h; u.hash='';
  let out = u.protocol+'//'+u.hostname+(u.port?':'+u.port:'')+u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'');
  if (out.endsWith('/') && !u.searchParams.toString()) out=out.slice(0,-1);
  return out.toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { destination, bidDollars, category, description, logoPath } = req.body || {};
    const bidCents = Math.round(Number(bidDollars) * 100);
    if (!Number.isInteger(bidCents) || bidCents < 500) return res.status(400).json({ error: 'Minimum bid is $5 (₹ ~418)' });
    if (bidCents > 99999900) return res.status(400).json({ error: 'Maximum is $999,999' });
    let desc = (description || '').replace(/<[^>]*>/g,'').trim().slice(0,200);
    const dest = normalize(destination);
    const cat = category || 'Other';
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await sb.from('entries').select('id,total_bid_cents').eq('destination', dest).maybeSingle();
    if (existing) {
      if (!desc) {
        const { data: full } = await sb.from('entries').select('description').eq('id', existing.id).single();
        desc = full?.description || '';
      }
    } else {
      if (!desc) return res.status(400).json({ error: 'description required' });
    }

    const platformCents = Math.floor(bidCents * 0.25);
    const donationCents = bidCents - platformCents;
    let entryId;
    if (existing) {
      entryId = existing.id;
      const upd = { category: cat, description: desc, status: 'pending', last_bid_at: new Date().toISOString() };
      if (logoPath) upd.logo_path = logoPath;
      const { error } = await sb.from('entries').update(upd).eq('id', entryId);
      if (error) throw error;
      try { await sb.from('entries').update({ bid_cents: bidCents, platform_cents: platformCents, donation_cents: donationCents }).eq('id', entryId); } catch {}
    } else {
      const slug = dest.replace(/^@/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Math.random().toString(36).slice(2,6);
      const display = dest.startsWith('@') ? dest : (()=>{ try{return new URL(dest).hostname.replace(/^www\./,'');}catch{return dest;}})();
      const { data: ins, error } = await sb.from('entries').insert({ slug, destination: dest, display_name: display, description: desc, category: cat, logo_path: logoPath||null, total_bid_cents: 0, donated_cents: 0, status: 'pending' }).select('id').single();
      if (error) throw error;
      entryId = ins.id;
      try { await sb.from('entries').update({ bid_cents: bidCents, platform_cents: platformCents, donation_cents: donationCents }).eq('id', entryId); } catch {}
    }

    // INR conversion - fixed 83.5 for estimate, or use live rate if needed
    const usd = bidCents / 100;
    const inrPaise = Math.round(usd * 83.5 * 100); // in paise
    const inrRupees = (inrPaise / 100).toFixed(2);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const siteUrl = host ? `${proto}://${host}` : SITE;
    const successUrl = `${siteUrl}/fee.html?id=${encodeURIComponent(entryId)}&provider=uropay`;
    const webhookUrl = `${siteUrl}/api/uropay-webhook`;

    // If UroPay credentials not configured, return local UPI intent + instructions (works without API)
    if (!UROPAY_API_KEY || !UROPAY_API_SECRET) {
      const vpa = UROPAY_VPA || 'savewater@icici';
      const note = `savewater.tech #${String(entryId).slice(0,8)}`;
      const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent('savewater.tech')}&am=${inrRupees}&cu=INR&tn=${encodeURIComponent(note)}`;
      return res.status(200).json({
        entryId,
        provider: 'upi-fallback',
        amountInr: inrRupees,
        amountUsd: usd.toFixed(2),
        donationCents,
        platformCents,
        bidCents,
        upiUrl,
        vpa,
        webhookUrl,
        successUrl,
        instructions: 'Pay via any UPI app (GPay/PhonePe/Paytm/BHIM). After paying, enter UPI Reference ID or wait for auto-confirm via UroPay Companion App SMS.',
      });
    }

    // Create order via UroPay Partner API
    // Docs vary: POST /api/create-order or /api/v1/order/create
    // We try primary endpoint, fallback to alternate
    const orderPayload = {
      amount: Number(inrRupees), // UroPay expects rupees
      amount_in_paise: inrPaise,
      currency: 'INR',
      order_id: entryId, // partnerOrderId
      partnerOrderId: entryId,
      customer_note: `savewater.tech leaderboard - ${dest.slice(0,60)}`,
      redirect_url: successUrl,
      webhook_url: webhookUrl,
      vpa: UROPAY_VPA,
      // UroPay order meta
      metadata: { entryId, dest, cat, site: siteUrl, donationCents, platformCents, bidCents }
    };

    let uropayRes = null, uropayData = null;
    const endpoints = [`${UROPAY_BASE}/create-order`, `${UROPAY_BASE}/v1/order/create`, `${UROPAY_BASE}/orders`];
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': UROPAY_API_KEY,
            'X-Api-Secret': UROPAY_API_SECRET,
            'Authorization': `Bearer ${UROPAY_API_KEY}`,
            'x-api-key': UROPAY_API_KEY,
          },
          body: JSON.stringify(orderPayload),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && (j.order_id || j.id || j.payment_url || j.upi_url || j.qr)) {
          uropayRes = r; uropayData = j; break;
        }
        lastErr = j;
        // try next endpoint if 404
        if (r.status === 404) continue;
        else { uropayData = j; break; }
      } catch (e) { lastErr = e.message; }
    }

    if (!uropayData || (!uropayData.payment_url && !uropayData.upi_url && !uropayData.qr && !uropayData.order_id && !uropayData.id)) {
      // fallback to UPI intent even if API fails, so Indians still can pay
      const vpa = UROPAY_VPA || 'savewater@icici';
      const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent('savewater.tech')}&am=${inrRupees}&cu=INR&tn=${encodeURIComponent('savewater.tech '+entryId.slice(0,8))}`;
      console.warn('UroPay create-order fallback', lastErr);
      return res.status(200).json({
        entryId, provider: 'upi-fallback',
        amountInr: inrRupees, amountUsd: usd.toFixed(2),
        donationCents, platformCents, bidCents,
        upiUrl, vpa, webhookUrl, successUrl,
        uropayError: lastErr,
      });
    }

    // success from UroPay
    const paymentUrl = uropayData.payment_url || uropayData.paymentUrl || uropayData.checkout_url || uropayData.url;
    const upiUrl = uropayData.upi_url || uropayData.upiUrl || uropayData.upiIntent;
    const qr = uropayData.qr || uropayData.qr_code || uropayData.qrCode;
    const orderId = uropayData.order_id || uropayData.orderId || uropayData.id;

    // store mapping
    try { await sb.from('entries').update({ uropay_order_id: String(orderId) }).eq('id', entryId); } catch {}

    return res.status(200).json({
      entryId, provider: 'uropay',
      orderId, paymentUrl, upiUrl, qr,
      amountInr: inrRupees, amountUsd: usd.toFixed(2),
      donationCents, platformCents, bidCents,
      raw: uropayData,
    });
  } catch (e) {
    console.error('create-uropay-order', e);
    return res.status(400).json({ error: e.message });
  }
}
