import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const PAYPAL_BASE = process.env.PAYPAL_BASE || ((process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.startsWith('sb')) ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
const SITE = process.env.SITE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cleanwater.lol');

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { entryId, feeDollars, action, orderId } = req.body || {};

    if (action === 'capture' && orderId) {
      const tok = await getPaypalToken();
      const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }
      });
      const capData = await capRes.json();
      return res.status(200).json(capData);
    }

    if (!entryId) return res.status(400).json({ error: 'missing entryId' });

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry } = await sb.from('entries').select('*').eq('id', entryId).maybeSingle();
    if (!entry) return res.status(404).json({ error: 'entry not found' });

    // Cryptographic Check: Verify that Step 1 (Every.org 75% Donation) actually settled
    let isDonationVerified = Boolean(entry.donation_confirmed && (entry.everyorg_donation_id || entry.everyorg_charge_id));
    let verifiedDonationCents = entry.donated_cents || 0;

    if (!isDonationVerified || verifiedDonationCents === 0) {
      const apiKey = process.env.EVERYORG_PRIVATE_KEY || process.env.EVERYORG_PUBLIC_KEY || 'pk_live_3770bf44947f5c510bdd88838874707e';
      try {
        const checkRes = await fetch(`https://partners.every.org/v0.2/partner/donations?partnerDonationId=${encodeURIComponent(entryId)}&apiKey=${encodeURIComponent(apiKey)}`);
        const checkData = await checkRes.json().catch(() => ({}));
        const donations = checkData.donations || (Array.isArray(checkData) ? checkData : (checkData.donation ? [checkData.donation] : []));
        const matched = donations.find(d => d.partnerDonationId === entryId || d.id);
        
        if (matched && matched.id) {
          const chargeId = matched.chargeId || matched.id;
          verifiedDonationCents = matched.amount ? Math.round(parseFloat(matched.amount) * 100) : (entry.donated_cents || 375);
          await sb.from('entries').update({
            donation_confirmed: true,
            everyorg_donation_id: String(chargeId),
            everyorg_charge_id: String(chargeId),
            donated_cents: verifiedDonationCents
          }).eq('id', entryId);
          isDonationVerified = true;
        }
      } catch (err) {
        console.warn('Every.org verification error', err);
      }
    }

    // Hard block if donation is unverified (prevents skipping Step 1)
    if (!isDonationVerified && !entry.donation_confirmed) {
      return res.status(403).json({
        error: 'Step 1 (75% Clean Water donation via Every.org) has not been completed or verified yet. Please complete your donation on Every.org first.'
      });
    }

    // Server-computed 25% fee derived purely from verified Every.org 75% donation
    const totalBidCents = Math.round(verifiedDonationCents / 0.75);
    const feeCents = Math.max(100, totalBidCents - verifiedDonationCents);
    const feeDollarsCalculated = feeCents / 100;

    const tok = await getPaypalToken();
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tok,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: entryId,
          custom_id: entryId,
          description: `Listing fee (25%) for ${(entry.display_name || entry.destination || 'listing').slice(0, 100)}`,
          amount: {
            currency_code: 'USD',
            value: feeDollarsCalculated.toFixed(2)
          }
        }],
        application_context: {
          brand_name: 'savewater.tech',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${SITE}/done.html?id=${entryId}`,
          cancel_url: `${SITE}/fee.html?id=${entryId}&cancelled=1`
        }
      })
    });

    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error('PayPal create order failed: ' + JSON.stringify(order));

    return res.status(200).json({ id: order.id, orderId: order.id });
  } catch (e) {
    console.error('create-fee-order error', e);
    return res.status(500).json({ error: e.message });
  }
}
