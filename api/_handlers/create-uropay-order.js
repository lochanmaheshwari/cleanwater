import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UROPAY_API_KEY = process.env.UROPAY_API_KEY;
const UROPAY_API_SECRET = process.env.UROPAY_API_SECRET;

function normalize(dest) {
  let s = (dest || '').trim();
  if (s.startsWith('@')) {
    const handle = s.slice(1);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Invalid X handle');
    return '@' + handle;
  }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  return u.origin + u.pathname.replace(/\/+$/, '');
}

function signRequest(method, path, query, body, secret, apiKey) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const canonical = [method, path, timestamp, nonce, query || '', body].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return {
    'X-Api-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
    'Content-Type': 'application/json'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const body = req.body || {};
    let { entryId, feeCents, destination, bidDollars, category, description, logoPath, amountInr: directInr } = body;

    if (!UROPAY_API_KEY || !UROPAY_API_SECRET) {
      return res.status(500).json({ 
        error: 'Uropay credentials not configured. Please add UROPAY_API_KEY and UROPAY_API_SECRET to environment variables in Vercel.' 
      });
    }

    const sb = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) 
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 
      : null;

    // If destination is provided, create/update entry in Supabase first
    if (!entryId && destination && sb) {
      const bidCents = Math.round(Number(bidDollars || 1) * 100);
      const dest = normalize(destination);
      let desc = (description || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
      let cat = category || 'Other';

      const { data: existing } = await sb.from('entries').select('id, total_bid_cents').eq('destination', dest).maybeSingle();
      if (existing) {
        entryId = existing.id;
        const updateData = {
          category: cat,
          status: 'pending',
          last_bid_at: new Date().toISOString()
        };
        if (desc) updateData.description = desc;
        if (logoPath) updateData.logo_path = logoPath;
        await sb.from('entries').update(updateData).eq('id', entryId);
      } else {
        const slug = dest.replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
        const display = dest.startsWith('@') ? dest : (() => { try { return new URL(dest).hostname.replace(/^www\./, ''); } catch { return dest; } })();

        const { data: ins, error: insErr } = await sb.from('entries').insert({
          slug,
          destination: dest,
          display_name: display,
          description: desc || display,
          category: cat,
          logo_path: logoPath || null,
          total_bid_cents: 0,
          donated_cents: 0,
          status: 'pending'
        }).select('id').single();

        if (insErr) throw insErr;
        entryId = ins.id;
      }
    }

    if (!entryId) {
      return res.status(400).json({ error: 'Missing entryId or destination' });
    }

    // Calculate amount in INR (~83.5 INR/USD)
    let inrAmount = 100;
    if (directInr && Number(directInr) > 0) {
      inrAmount = Math.max(1, Math.round(Number(directInr)));
    } else if (bidDollars && Number(bidDollars) > 0) {
      inrAmount = Math.max(1, Math.round(Number(bidDollars) * 83.5));
    } else if (feeCents && Number(feeCents) > 0) {
      inrAmount = Math.max(1, Math.round((Number(feeCents) / 100) * 83.5));
    }

    const tenantOrderRef = `${String(entryId).slice(0, 8)}-${Date.now()}`;
    const orderPath = '/v1/orders';
    const bodyStr = JSON.stringify({
      tenantOrderRef,
      amount: inrAmount,
      currency: 'INR',
      paymentMethods: ['upi'],
      metaData: {
        entryId: String(entryId)
      }
    });

    const headers = signRequest('POST', orderPath, '', bodyStr, UROPAY_API_SECRET, UROPAY_API_KEY);

    const uropayReq = await fetch('https://api.uropai.in' + orderPath, {
      method: 'POST',
      headers,
      body: bodyStr
    });

    const uropayRes = await uropayReq.json().catch(() => ({}));

    if (!uropayReq.ok || (uropayRes.status !== 'success' && uropayRes.code !== 201 && uropayRes.code !== 200)) {
      console.error('Uropay error response:', uropayRes);
      return res.status(500).json({ 
        error: uropayRes.message || 'Failed to create Uropay order', 
        details: uropayRes 
      });
    }

    const orderData = uropayRes.data || {};
    const openUrl = orderData.openUrl || orderData.checkoutUrl || '';

    // Record uropay order ID on Supabase entry
    if (sb && entryId) {
      try {
        await sb.from('entries').update({
          uropay_order_id: orderData.id || tenantOrderRef
        }).eq('id', entryId);
      } catch (dbErr) {
        console.warn('Could not save uropay_order_id to DB:', dbErr);
      }
    }

    return res.status(200).json({
      success: true,
      orderId: orderData.id,
      tenantOrderRef,
      amountInr: inrAmount,
      checkout_url: openUrl,
      openUrl: openUrl,
      paymentUrl: openUrl,
      upiUrl: openUrl,
      entryId
    });

  } catch (err) {
    console.error('Uropay order error:', err);
    return res.status(500).json({ error: err.message });
  }
}
