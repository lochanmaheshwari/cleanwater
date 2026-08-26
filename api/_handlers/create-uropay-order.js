import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  
  try {
    const { entryId, feeCents } = req.body;
    if (!entryId || !feeCents) return res.status(400).json({ error: 'Missing entryId or feeCents' });

    const UROPAY_API_KEY = process.env.UROPAY_API_KEY;
    if (!UROPAY_API_KEY) {
      return res.status(500).json({ error: 'Uropay API key not configured on server' });
    }

    // Call Uropay API to create an order
    const uropayReq = await fetch('https://dashboard.uropay.in/api/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UROPAY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: feeCents, // Amount in cents/paise
        currency: 'INR',
        receipt: entryId, // Pass the entry ID as receipt/reference
        notes: {
          entryId: entryId
        }
      })
    });

    const uropayRes = await uropayReq.json();
    
    if (!uropayReq.ok) {
      console.error('Uropay error:', uropayRes);
      return res.status(500).json({ error: 'Failed to create Uropay order', details: uropayRes });
    }

    // Return the checkout URL to redirect the user
    return res.status(200).json({ 
      checkout_url: uropayRes.checkout_url || uropayRes.payment_url || uropayRes.short_url 
    });

  } catch (err) {
    console.error('Uropay order error:', err);
    return res.status(500).json({ error: err.message });
  }
}
