import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ecvumloyecjefvryjgaf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdnVtbG95ZWNqZWZ2cnlqZ2FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY1NDkzOCwiZXhwIjoyMTAzMjMwOTM4fQ.T2Cs93d8QnHcpoMJgtFgUD0chiWSqiPxItzdihmwZko';

function normalize(raw){
  let s=(raw||'').trim();
  if(!s) throw new Error('enter url or handle');
  if(s.startsWith('@')) return '@'+s.slice(1).toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(!s.includes('.') && !s.includes('/') && !s.includes(':') && /^[a-zA-Z0-9_]{1,15}$/.test(s)) return '@'+s.toLowerCase();
  if(!/^https?:\/\//i.test(s)) s='https://'+s;
  const u=new URL(s);
  let host=u.hostname.toLowerCase().replace(/^www\./,'');
  u.hostname=host;
  // strip tracking
  const TRACK=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','igshid'];
  for(const k of [...u.searchParams.keys()]) if(TRACK.includes(k.toLowerCase())||k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  u.hash='';
  let out=u.protocol+'//'+u.hostname+(u.port?':'+u.port:'')+u.pathname+ (u.searchParams.toString()?'?'+u.searchParams.toString():'');
  if(out.endsWith('/') && !u.searchParams.toString()) out=out.slice(0,-1);
  return out.toLowerCase();
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method not allowed'});
  try{
    const {destination, amount_cents, category} = req.body || {};
    const amt = parseInt(amount_cents,10);
    if(!Number.isInteger(amt) || amt<500 || amt>99999900) return res.status(400).json({error:'$5–$999,999 whole dollars only'});
    if(amt%100!==0) return res.status(400).json({error:'whole dollars only'});
    const dest=normalize(destination);
    const supabase=createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // check top bid for #1 rule
    const {data:live} = await supabase.from('entries').select('total_bid_cents').eq('status','live').order('total_bid_cents',{ascending:false}).limit(1);
    const top = live && live[0] ? live[0].total_bid_cents : 0;
    // if this dest already exists, adding should still respect #1 rule on total
    const {data:existing}=await supabase.from('entries').select('id,total_bid_cents').eq('destination',dest).maybeSingle();
    const newTotal = existing ? existing.total_bid_cents + amt : amt;
    if(newTotal>top && top>0 && newTotal < top+500){
      return res.status(400).json({error:`taking #1 costs at least $${(top/100+5).toFixed(0)}`});
    }
    // upsert entry awaiting_donation
    let entryId;
    if(existing){
      entryId=existing.id;
      await supabase.from('entries').update({last_bid_at:new Date().toISOString(), category: category||undefined}).eq('id',entryId);
    } else {
      const slug = dest.replace(/^@/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'entry-'+Date.now();
      const display = dest.startsWith('@') ? dest : (()=>{ try{return new URL(dest).hostname.replace(/^www\./,'')}catch{return dest}})();
      const {data:ins, error}=await supabase.from('entries').insert({
        slug: slug + '-' + Math.random().toString(36).slice(2,6),
        destination: dest,
        display_name: display,
        description: 'AI product ranked by bid.',
        category: category||'AI tools',
        total_bid_cents: 0,
        status: 'awaiting_donation'
      }).select('id').single();
      if(error) throw error;
      entryId=ins.id;
    }
    // store pending bid meta? create bids row pending? we create after webhooks instead, just return id
    return res.status(200).json({entryId, destination:dest, amount_cents:amt});
  }catch(e){
    console.error(e);
    return res.status(400).json({error:e.message});
  }
}
