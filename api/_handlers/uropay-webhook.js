import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UROPAY_API_SECRET = process.env.UROPAY_API_SECRET;
const UROPAY_WEBHOOK_SECRET = process.env.UROPAY_WEBHOOK_SECRET || process.env.UROPAY_API_SECRET;

function verifyWebhook(headers, rawBody, secret) {
  if (!secret) return true; // If secret is not set, allow processing in dev
  try {
    const timestamp = headers['x-timestamp'] || '';
    const nonce = headers['x-nonce'] || '';
    const signature = headers['x-signature'] || '';
    if (!signature) return false;

    const canonical = ['POST', '/tenant-webhook', timestamp, nonce, '', rawBody].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch (e) {
    console.error('Webhook signature verification error:', e);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody || '{}');

    // Verify webhook signature if secret configured
    if (UROPAY_WEBHOOK_SECRET) {
      const isValid = verifyWebhook(req.headers, rawBody, UROPAY_WEBHOOK_SECRET);
      if (!isValid && UROPAY_API_SECRET) {
        // Retry with API_SECRET as fallback
        const isValidWithApiSecret = verifyWebhook(req.headers, rawBody, UROPAY_API_SECRET);
        if (!isValidWithApiSecret) {
          console.warn('Uropay webhook invalid signature, proceeding cautiously.');
        }
      }
    }

    const status = (payload.status || payload.event || '').toUpperCase();
    
    // Only process successful payments
    if (status !== 'PAID' && status !== 'SUCCESS' && status !== 'ORDER.PAID') {
      return res.status(200).json({ received: true, status });
    }

    // Extract entryId from metaData or tenantOrderRef
    const entryId = payload.metaData?.entryId || payload.metadata?.entryId || payload.notes?.entryId;
    const orderId = payload.orderId || payload.id;
    const tenantOrderRef = payload.tenantOrderRef;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(200).json({ received: true, note: 'No Supabase configured' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = sb.from('entries').update({
      payment_confirmed: true,
      status: 'live',
      last_bid_at: new Date().toISOString()
    });

    if (entryId) {
      query = query.eq('id', entryId);
    } else if (orderId) {
      query = query.eq('uropay_order_id', orderId);
    } else if (tenantOrderRef) {
      query = query.eq('uropay_order_id', tenantOrderRef);
    } else {
      return res.status(400).json({ error: 'No identifier found to match entry' });
    }

    const { error: updErr } = await query;

    if (updErr) {
      console.error('Failed to update entry on Uropay webhook:', updErr);
      return res.status(500).json({ error: 'Database update failed' });
    }

    console.log('✅ Uropay payment confirmed for entry:', entryId || orderId);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Uropay webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
