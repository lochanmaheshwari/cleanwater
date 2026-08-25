import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

// rate limit in memory
const hits = new Map();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = hits.get(ip) || [];
  const recent = arr.filter(t => now - t < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: 'rate limited — please wait a moment' });
  recent.push(now);
  hits.set(ip, recent);

  const { filename, contentType, fileData } = req.body || {};
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
  if (contentType && !allowed.includes(contentType)) {
    return res.status(400).json({ error: 'png, jpg, webp, svg only' });
  }

  const ext = (filename || 'logo.webp').split('.').pop().toLowerCase();
  const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext) ? ext : 'webp';
  const path = `pending/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Ensure bucket exists
  try {
    await supabase.storage.createBucket('logos', { public: true });
  } catch {}

  // If client sent base64 file data directly, upload immediately with service role
  if (fileData) {
    try {
      const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const { data: upData, error: upError } = await supabase.storage
        .from('logos')
        .upload(path, buffer, {
          contentType: contentType || 'image/webp',
          upsert: true
        });

      if (upError) throw upError;

      const { data: pubData } = supabase.storage.from('logos').getPublicUrl(path);
      return res.status(200).json({
        path,
        publicUrl: pubData?.publicUrl || path,
        uploaded: true
      });
    } catch (directErr) {
      console.error('direct upload error', directErr);
      return res.status(500).json({ error: 'Storage upload failed: ' + directErr.message });
    }
  }

  // Otherwise, attempt to create signed upload URL
  try {
    const { data, error } = await supabase.storage.from('logos').createSignedUploadUrl(path);
    if (error) throw error;
    return res.status(200).json({ signedUrl: data.signedUrl, path, token: data.token });
  } catch (err) {
    console.error('signed upload error, falling back to direct upload request', err);
    return res.status(200).json({
      useDirectUpload: true,
      path,
      fallbackUrl: '/api/logo-upload'
    });
  }
}
