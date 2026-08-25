import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';
const SITE = process.env.SITE || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://savewater.tech');
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';

let paypalToken=null, tokenExp=0;
async function getPaypalToken(){
  if(paypalToken && Date.now() < tokenExp - 60000) return paypalToken;
  const id=process.env.PAYPAL_CLIENT_ID, secret=process.env.PAYPAL_SECRET;
  if(!id || !secret) throw new Error('PayPal not configured');
  const r=await fetch(`${PAYPAL_BASE}/v1/oauth2/token`,{
    method:'POST',
    headers:{'Authorization':'Basic '+Buffer.from(id+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'
  });
  const j=await r.json();
  if(!r.ok) throw new Error('paypal token failed: '+JSON.stringify(j));
  paypalToken=j.access_token;
  tokenExp=Date.now() + j.expires_in*1000;
  return paypalToken;
}
async function paypal(path, body){
  const tok=await getPaypalToken();
  const r=await fetch(`${PAYPAL_BASE}${path}`,{
    method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const j=await r.json();
  if(!r.ok) throw new Error(`paypal ${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

function normalize(raw){
  let s=(raw||'').trim();
  if(!s) throw new Error('enter url or handle');
  if(s.startsWith('@')) return '@'+s.slice(1).toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(!s.includes('.') && !s.includes('/') && !s.includes(':') && /^[a-zA-Z0-9_]{1,15}$/.test(s)) return '@'+s.toLowerCase();
  if(!/^https?:\/\//i.test(s)) s='https://'+s;
  const u=new URL(s);
  const host=u.hostname.toLowerCase();
  if(host.includes('discord.gg') || (host.includes('discord.com')&&u.pathname.includes('/invite'))) throw new Error('chat invite links not allowed');
  if(host.includes('t.me') || host.includes('telegram.me')) throw new Error('chat invite links not allowed');
  if(host.includes('chat.whatsapp.com')) throw new Error('chat invite links not allowed');
  const bare=host.replace(/^www\./,'');
  const block=['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','buff.ly','shorturl.at','is.gd','rebrand.ly','cutt.ly'];
  if(block.includes(bare) || block.includes(host)) throw new Error('link shorteners not allowed');
  if(/(porn|xxx|sex|adult|nsfw)/i.test(u.href)) throw new Error('adult content not allowed');
  const TRACK=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','igshid'];
  for(const k of [...u.searchParams.keys()]) if(TRACK.includes(k.toLowerCase())||k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  let h=u.hostname.toLowerCase().replace(/^www\./,'');
  u.hostname=h;
  u.hash='';
  let out=u.protocol+'//'+u.hostname+(u.port?':'+u.port:'')+u.pathname+ (u.searchParams.toString()?'?'+u.searchParams.toString():'');
  if(out.endsWith('/') && !u.searchParams.toString()) out=out.slice(0,-1);
  return out.toLowerCase();
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  try{
    const { destination, bidDollars, category, description, logoPath } = req.body || {};
    const bidCents = Math.round(Number(bidDollars) * 100);
    if(!Number.isInteger(bidCents) || bidCents < 500) return res.status(400).json({error:'Minimum bid is $5'});
    if(bidCents > 99999900) return res.status(400).json({error:'Maximum is $999,999'});
    // description
    let desc = (description||'').replace(/<[^>]*>/g,'').trim().slice(0,200);
    // normalize
    const dest=normalize(destination);
    const cat = category || 'Other';
    // validate logo path if provided
    if(logoPath){
      // must be pending/...
      if(!logoPath.startsWith('pending/')) return res.status(400).json({error:'invalid logo path'});
    }

    const sb=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // check existing
    const {data:existing} = await sb.from('entries').select('id, total_bid_cents').eq('destination', dest).maybeSingle();
    if(existing){
      // for existing, logo/desc optional — if blank keep existing
      if(!desc){
        const {data:full}=await sb.from('entries').select('description').eq('id', existing.id).single();
        desc=full?.description||'';
      }
    } else {
      if(!desc) return res.status(400).json({error:'description required'});
      if(!logoPath) return res.status(400).json({error:'logo required'});
      // verify logo exists in storage
      const {data:exists, error:stErr} = await sb.storage.from('logos').list('pending', {limit:100});
      // simple check: file must have been uploaded (we trust path, but ensure it exists via head)
      // skip strict check for now
    }

    const platformCents = Math.floor(bidCents * 0.25);
    const donationCents = bidCents - platformCents;

    let entryId, isUpdate=false;
    if(existing){
      entryId=existing.id;
      isUpdate=true;
      // update existing entry to pending/paid state? create new pending bid entry? per spec: add to total, status pending
      await sb.from('entries').update({
        bid_cents: bidCents,
        platform_cents: platformCents,
        donation_cents: donationCents,
        category: cat,
        description: desc,
        ...(logoPath?{logo_path: logoPath, logo_status:'pending'}:{}),
        // we keep total_bid_cents as sum? will be updated on live, but store bid for now
        status:'pending',
        paid_at:null, donated_at:null
      }).eq('id', entryId);
    } else {
      const slug = dest.replace(/^@/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) + '-' + Math.random().toString(36).slice(2,6);
      const display = dest.startsWith('@') ? dest : (()=>{ try{return new URL(dest).hostname.replace(/^www\./,'')}catch{return dest}})();
      const {data:ins, error} = await sb.from('entries').insert({
        slug,
        destination: dest,
        display_name: display,
        description: desc,
        category: cat,
        logo_path: logoPath,
        logo_status:'pending',
        bid_cents: bidCents,
        platform_cents: platformCents,
        donation_cents: donationCents,
        total_bid_cents: 0,
        donated_cents: 0,
        status:'pending'
      }).select('id').single();
      if(error) throw error;
      entryId=ins.id;
    }

    // create PayPal order for platformCents only
    let approveLink=null;
    try{
      const order=await paypal('/v2/checkout/orders',{
        intent:'CAPTURE',
        purchase_units:[{
          reference_id: entryId,
          custom_id: entryId,
          amount:{ currency_code:'USD', value:(platformCents/100).toFixed(2) },
          description:'Leaderboard listing'
        }],
        application_context:{
          return_url:`${SITE}/api/to-donation?id=${entryId}`,
          cancel_url:`${SITE}/?cancelled=1`,
          shipping_preference:'NO_SHIPPING',
          user_action:'PAY_NOW',
          brand_name:'savewater.tech'
        }
      });
      const link=order.links?.find(l=>l.rel==='approve')?.href;
      approveLink=link;
      await sb.from('entries').update({ paypal_order_id: order.id }).eq('id', entryId);
      return res.status(200).json({ entryId, approveLink, orderId: order.id, platformCents, donationCents });
    }catch(payErr){
      console.error('paypal order failed', payErr);
      // still return entry but indicate paypal not configured — for sandbox testing, return fake link
      if(!process.env.PAYPAL_CLIENT_ID){
        // mock: return to-donation directly
        return res.status(200).json({ entryId, approveLink: `${SITE}/api/to-donation?id=${entryId}`, mock:true, platformCents, donationCents, warning:'PayPal not configured — using mock' });
      }
      return res.status(500).json({error:'PayPal order failed: '+payErr.message});
    }
  }catch(e){
    console.error(e);
    return res.status(400).json({error:e.message});
  }
}
