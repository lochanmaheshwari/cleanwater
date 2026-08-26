import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const payload = req.body;
    
    // Uropay webhook logic
    // Usually, Uropay sends order status events, e.g., order.paid
    const status = payload.status || payload.event;
    
    // If it's not a success event, just acknowledge
    if (status !== 'PAID' && status !== 'order.paid' && status !== 'SUCCESS') {
      return res.status(200).json({ received: true });
    }

    // Extract the entry ID which we passed as 'receipt' or 'notes.entryId'
    const entryId = payload.receipt || (payload.notes && payload.notes.entryId) || payload.order_id;

    if (!entryId) {
      return res.status(400).json({ error: 'No entryId found in webhook payload' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update Supabase to mark the listing as paid and live
    const { error: updErr } = await sb.from('entries')
      .update({
        payment_confirmed: true,
        status: 'live'
      })
      .eq('id', entryId);

    if (updErr) {
      console.error('Failed to update entry on Uropay webhook:', updErr);
      return res.status(500).json({ error: 'Database update failed' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Uropay webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
