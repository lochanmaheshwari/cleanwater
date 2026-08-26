import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const SITE = process.env.SITE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://savewater.tech');
const PAYPAL_BASE = process.env.PAYPAL_BASE || ((process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.startsWith('sb')) ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

let paypalToken = null;
let tokenExp = 0;

async function getPaypalToken() {
  if (paypalToken && Date.now() < tokenExp - 60000) return paypalToken;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error('PayPal not configured');
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok) throw new Error('paypal token failed: ' + JSON.stringify(j));
  paypalToken = j.access_token;
  tokenExp = Date.now() + j.expires_in * 1000;
  return paypalToken;
}

async function paypal(path, body) {
  const tok = await getPaypalToken();
  const r = await fetch(`${PAYPAL_BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`paypal ${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

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
  const block = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly', 'shorturl.at', 'is.gd', 'rebrand.ly', 'cutt.ly'];
  if (block.includes(bare) || block.includes(host)) throw new Error('link shorteners not allowed');
  if (/(porn|xxx|sex|adult|nsfw)/i.test(u.href)) throw new Error('adult content not allowed');
  const TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'igshid'];
  for (const k of [...u.searchParams.keys()]) if (TRACK.includes(k.toLowerCase()) || k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  let h = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hostname = h;
  u.hash = '';
  let out = u.protocol + '//' + u.hostname + (u.port ? ':' + u.port : '') + u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
  if (out.endsWith('/') && !u.searchParams.toString()) out = out.slice(0, -1);
  return out.toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { destination, bidDollars, category, description, logoPath } = req.body || {};
    const bidCents = Math.round(Number(bidDollars) * 100);
    if (!Number.isInteger(bidCents) || bidCents < 500) return res.status(400).json({ error: 'Minimum bid is $5' });
    if (bidCents > 99999900) return res.status(400).json({ error: 'Maximum is $999,999' });

    let desc = (description || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
    const dest = normalize(destination);
    const cat = category || 'Other';

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // check existing
    const { data: existing } = await sb.from('entries').select('id, total_bid_cents').eq('destination', dest).maybeSingle();
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
      // update standard schema first
      const updateData = {
        category: cat,
        description: desc,
        status: 'pending',
        last_bid_at: new Date().toISOString()
      };
      if (logoPath) updateData.logo_path = logoPath;

      const { error: updErr } = await sb.from('entries').update(updateData).eq('id', entryId);
      if (updErr) throw updErr;

      // attempt to update optional extended fields if table supports them
      try {
        await sb.from('entries').update({
          bid_cents: bidCents,
          platform_cents: platformCents,
          donation_cents: donationCents
        }).eq('id', entryId);
      } catch {}
    } else {
      const slug = dest.replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
      const display = dest.startsWith('@') ? dest : (() => { try { return new URL(dest).hostname.replace(/^www\./, ''); } catch { return dest; } })();

      // insert with standard schema columns guaranteed to exist
      const insertData = {
        slug,
        destination: dest,
        display_name: display,
        description: desc,
        category: cat,
        logo_path: logoPath || null,
        total_bid_cents: 0,
        donated_cents: 0,
        status: 'pending'
      };

      const { data: ins, error: insErr } = await sb.from('entries').insert(insertData).select('id').single();
      if (insErr) throw insErr;
      entryId = ins.id;

      // try optional fields update
      try {
        await sb.from('entries').update({
          bid_cents: bidCents,
          platform_cents: platformCents,
          donation_cents: donationCents
        }).eq('id', entryId);
      } catch {}
    }

    // Step 1: Every.org 75% clean water donation URL
    let slug = (process.env.EVERYORG_FUNDRAISER_SLUG || 'clean-water-funded-by').trim();
    slug = slug.replace(/^https?:\/\/(www\.)?every\.org\//i, '');
    slug = slug.replace(/^(water-org\/f\/)+/i, '');
    slug = slug.replace(/^water-org\//i, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const siteUrl = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || 'https://savewater.tech');

    const donationDollars = (donationCents / 100).toFixed(2);
    const targetRedirect = `${siteUrl}/fee.html?id=${encodeURIComponent(entryId)}`;
    const donationUrl = `https://www.every.org/water-org/f/${slug}`
      + `?amount=${encodeURIComponent(donationDollars)}`
      + `&partnerDonationId=${encodeURIComponent(entryId)}`
      + `&redirectUrl=${encodeURIComponent(targetRedirect)}`
      + `&success_url=${encodeURIComponent(targetRedirect)}`
      + `&returnUrl=${encodeURIComponent(targetRedirect)}`
      + `&exitUrl=${encodeURIComponent(targetRedirect)}`
      + `&method=card`;

    return res.status(200).json({
      entryId,
      donationUrl,
      donationCents,
      platformCents,
      bidCents
    });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e.message });
  }
}
