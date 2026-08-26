import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const SITE = process.env.SITE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://savewater.tech');

export default async function handler(req, res) {
  const id = (req.query.id || req.query.entryId || '').toString();
  if (!id) return res.redirect(302, '/?error=notfound');

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let { data: entry } = await sb.from('entries').select('*').eq('id', id).single();
  if (!entry) return res.redirect(302, '/?error=notfound');

  // poll briefly if still pending
  let e = entry;
  for (let i = 0; i < 10 && e.status === 'pending'; i++) {
    await new Promise(r => setTimeout(r, 500));
    const { data } = await sb.from('entries').select('*').eq('id', id).single();
    if (data) e = data;
  }

  if (e.status === 'voided') return res.redirect(302, `/?error=voided`);

  // Calculate donation amount (75%)
  let donationCents = req.query.donation ? parseInt(req.query.donation, 10) : (e.donation_cents || e.donated_cents || 375);
  if (!donationCents || isNaN(donationCents)) {
    donationCents = 375;
  }
  const amount = (donationCents / 100).toFixed(2);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const siteUrl = host ? `${proto}://${host}` : SITE;

  let slug = (process.env.EVERYORG_FUNDRAISER_SLUG || 'clean-water-funded-by').trim();
  slug = slug.replace(/^https?:\/\/(www\.)?every\.org\//i, '');
  slug = slug.replace(/^(water-org\/f\/)+/i, '');
  slug = slug.replace(/^water-org\//i, '');
  const targetRedirect = `${siteUrl}/fee.html?id=${encodeURIComponent(e.id)}`;
  const url = `https://www.every.org/water-org/f/${slug}`
    + `?amount=${encodeURIComponent(amount)}`
    + `&partnerDonationId=${encodeURIComponent(e.id)}`
    + `&redirectUrl=${encodeURIComponent(targetRedirect)}`
    + `&success_url=${encodeURIComponent(targetRedirect)}`
    + `&returnUrl=${encodeURIComponent(targetRedirect)}`
    + `&exitUrl=${encodeURIComponent(targetRedirect)}`
    + `&method=card`;

  return res.redirect(302, url);
}
