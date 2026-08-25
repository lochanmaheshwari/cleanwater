import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';
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
    const { entryId, feeDollars } = req.body || {};
    if (!entryId) return res.status(400).json({ error: 'missing entryId' });

    const fee = Math.max(1, parseFloat(feeDollars) || 2.50);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: entry } = await sb.from('entries').select('*').eq('id', entryId).maybeSingle();
    if (!entry) return res.status(404).json({ error: 'entry not found' });

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
          description: `Listing fee (25%) for ${entry.display_name || entry.destination}`,
          amount: {
            currency_code: 'USD',
            value: fee.toFixed(2)
          }
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'cleanwater.lol',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              landing_page: 'GUEST_CHECKOUT',
              return_url: `${SITE}/done.html?id=${entryId}`,
              cancel_url: `${SITE}/fee.html?id=${entryId}&cancelled=1`
            }
          }
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
