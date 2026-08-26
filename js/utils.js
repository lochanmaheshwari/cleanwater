import { CONFIG } from './config.js';

export function normalizeDestination(raw){
  let s = raw.trim();
  if(!s) throw new Error('enter a url or @handle');
  if(s.startsWith('@')){
    const h = s.slice(1).trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    if(!h) throw new Error('invalid handle');
    return '@'+h;
  }
  // handle X handle without @? treat as handle if no dot
  if(!s.includes('.') && !s.includes('/') && !s.includes(':') && /^[a-zA-Z0-9_]{1,15}$/.test(s)){
    return '@'+s.toLowerCase();
  }
  // ensure protocol
  if(!/^https?:\/\//i.test(s)) s = 'https://'+s;
  let u;
  try{ u = new URL(s); } catch{ throw new Error('invalid url'); }
  // reject chat/invite links
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  const href = u.href.toLowerCase();
  if(host.includes('discord.gg') || host.includes('discord.com/invite') || path.includes('/invite') && host.includes('discord')) throw new Error('chat invite links not allowed');
  if(host.includes('t.me') || host.includes('telegram.me')) throw new Error('chat invite links not allowed');
  if(host.includes('chat.whatsapp.com') || host.includes('slack.com') && path.includes('invite')) throw new Error('chat invite links not allowed');
  // shorteners
  const bareHost = host.replace(/^www\./,'');
  if(CONFIG.BLOCKED_SHORTENERS.includes(bareHost) || CONFIG.BLOCKED_SHORTENERS.includes(host)) throw new Error('link shorteners not allowed');
  // adult content naive check on url
  if(/(porn|xxx|sex|adult|nsfw)/i.test(href)) throw new Error('adult content not allowed');

  // strip tracking params
  const params = new URLSearchParams(u.search);
  for(const k of [...params.keys()]){
    if(CONFIG.TRACKING_PARAMS.includes(k.toLowerCase()) || k.toLowerCase().startsWith('utm_')) params.delete(k);
  }
  u.search = params.toString() ? '?'+params.toString() : '';
  // normalise host
  let hostname = u.hostname.toLowerCase().replace(/^www\./,'');
  u.hostname = hostname;
  // remove trailing slash except root
  let pathname = u.pathname;
  if(pathname !== '/' && pathname.endsWith('/')) pathname = pathname.slice(0,-1);
  // lower case host, keep path case? normalise lower for dedupe
  u.pathname = pathname;
  // remove hash
  u.hash = '';
  // rebuild without www and without tracking, preserve port if any
  let out = u.protocol + '//' + u.hostname + (u.port?':'+u.port:'') + u.pathname + u.search;
  // remove trailing slash for root?
  if(out.endsWith('/') && !u.search) out = out.slice(0,-1);
  return out.toLowerCase();
}

export function formatMoney(cents){
  const val = (cents / 100);
  if (cents % 100 === 0) {
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function formatMoney2(cents){
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
if (typeof window !== 'undefined') {
  window.formatMoney = formatMoney;
  window.formatMoney2 = formatMoney2;
}
export function timeAgo(iso){
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff/1000);
  if(s<60) return 'just now';
  const m=Math.floor(s/60); if(m<60) return m+' minute'+(m>1?'s':'')+' ago';
  const h=Math.floor(m/60); if(h<24) return h+' hour'+(h>1?'s':'')+' ago';
  const d=Math.floor(h/24); return d+' day'+(d>1?'s':'')+' ago';
}
export function hoursSince(iso){
  return Math.floor((Date.now()-new Date(iso).getTime())/3600000);
}
export function initials(name){
  if(!name) return '?';
  const parts=name.split(/\s+/).filter(Boolean);
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}
export function esc(s){
  const d=document.createElement('div'); d.textContent=s; return d.innerHTML;
}

export function getLogoUrl(path, domain){
  if(path && (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:'))) return path;
  if(path) return `https://ecvumloyecjefvryjgaf.supabase.co/storage/v1/object/public/logos/${path.replace(/^\/+/,'')}`;
  if(domain) {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('?')[0];
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=128`;
  }
  return '';
}
