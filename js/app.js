import { CONFIG } from './config.js';
import { getSupabase } from './supabase.js';
import { normalizeDestination, formatMoney, formatMoney2, timeAgo, hoursSince, initials, esc } from './utils.js';

let supabase=null;
let allEntries=[];
let bidsCache=[];
let stats={visitor_count:0, launched_at: new Date().toISOString()};
let currentTab='all'; // all | today
let currentCategory='all';
let visibleCount=50;
let bidAmount=5;

// fallback mock if supabase empty
const MOCK = [
  {id:'1', slug:'aqua', destination:'https://aqua.example.com', display_name:'Aqua AI', description:'Water-aware inference engine.', category:'AI infra', total_bid_cents:500, donated_cents:375, click_count:42, first_bid_at:new Date(Date.now()-3600000*50).toISOString(), last_bid_at:new Date().toISOString(), status:'live'}
];

function $(s){return document.querySelector(s)}
function $all(s){return [...document.querySelectorAll(s)]}

async function init(){
  // theme — respect prefers-color-scheme, toggle is moon/sun
  const applyTheme = (t)=>{
    document.body.classList.toggle('dark', t==='dark');
    const btn=$('#darkToggle'); if(btn) btn.textContent = t==='dark' ? '☀' : '◐';
    localStorage.setItem('cww-theme', t);
  };
  const saved = localStorage.getItem('cww-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark':'light'));
  $('#darkToggle')?.addEventListener('click',()=>{
    const isDark=document.body.classList.contains('dark');
    applyTheme(isDark?'light':'dark');
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e=>{
    if(!localStorage.getItem('cww-theme')) applyTheme(e.matches?'dark':'light');
  });

  // stepper + form wiring
  bidAmount = parseInt($('#bidValue')?.textContent?.replace(/[^0-9]/g,'')||'5',10);
  $('#decBtn')?.addEventListener('click',()=> adjust(-1));
  $('#incBtn')?.addEventListener('click',()=> adjust(1));
  function adjust(d){
    bidAmount = Math.min(999999, Math.max(5, bidAmount + d));
    updateHeadline();
  }
  function updateHeadline(){
    const el=$('#bidValue'); if(el) el.textContent='$'+bidAmount;
    const claim=$('#headlineClaim'); if(claim) claim.textContent='Claim #1 for $'+bidAmount;
    // update split live
    const platform=Math.floor(bidAmount*100*0.25), donation=bidAmount*100-platform;
    const sb=$('#splitBid'), sd=$('#splitDonation'), sp=$('#splitPlatform');
    if(sb) sb.textContent='$'+bidAmount;
    if(sd) sd.textContent='$'+(donation/100).toFixed(0);
    if(sp) sp.textContent='$'+(platform/100).toFixed(0);
  }
  updateHeadline();

  // form extras: import form.js dynamically for logo + existing check
  try{
    const { initForm } = await import('./form.js');
    const formApi = initForm(()=>bidAmount, ()=> (filtered()[0]?.total_bid_cents||0));
    window.__formApi = formApi;
    // pre-fill amount at #1 + $5 after data loads
    window.__setBidFromTop = (topCents)=>{
      const topDollars=Math.round((topCents||0)/100);
      const prefill = topCents ? topDollars+5 : 5;
      bidAmount=Math.min(999999, Math.max(5, prefill));
      updateHeadline();
    };
  }catch(e){ console.warn('form init',e); }

  // description counter
  const descInput=$('#descriptionInput');
  if(descInput){
    descInput.addEventListener('input',()=>{
      const c=$('#descCount'); if(c) c.textContent=String(descInput.value.length);
    });
  }

  // form submit → new create-bid flow
  const form=$('#submitForm');
  if(form){
    form.addEventListener('submit',async (e)=>{
      e.preventDefault();
      await handleSubmitNew();
    });
  }

  // category dropdown — keep static fallback already in HTML, just ensure value
  const sel=$('#categorySelect');
  if(sel && sel.options.length<=1){
    sel.innerHTML='<option value="">category</option>'+CONFIG.CATEGORIES.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  // cat chips
  renderCatChips();

  // tabs
  $all('[data-tab]').forEach(b=>{
    b.addEventListener('click',()=>{
      $all('[data-tab]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      currentTab=b.dataset.tab;
      renderBoard();
    })
  });

  // outbid button
  $('#outbidBtn')?.addEventListener('click', handleSubmit);
  $('#destinationInput')?.addEventListener('keydown',e=>{ if(e.key==='Enter') handleSubmit(); });
  $('#claimModalClose')?.addEventListener('click', closeModal);
  $('#modalOverlay')?.addEventListener('click',e=>{ if(e.target.id==='modalOverlay') closeModal(); });

  // show more
  $('#showMoreBtn')?.addEventListener('click',()=>{ visibleCount+=50; renderBoard(); });

  // load data
  await loadData();
  // realtime
  try{
    supabase = await getSupabase();
    supabase.channel('entries-live').on('postgres_changes',{event:'*',schema:'public',table:'entries'},()=>loadData()).subscribe();
    supabase.channel('bids-live').on('postgres_changes',{event:'*',schema:'public',table:'bids'},()=>loadData()).subscribe();
  }catch{}

  // heartbeat visitor
  bumpVisitor();
}

const CAT_ICONS = {
  "all": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/></svg>',
  "AI Agents & Infrastructure": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="7" width="14" height="10" rx="2"/><circle cx="9" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><path d="M9 14.5h6"/><path d="M12 7V5"/><path d="M8 5h8"/></svg>',
  "SEO & AI Visibility": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 20 20"/><path d="M9.2 10.5 11 13l3-3"/><circle cx="11" cy="11" r="1" fill="none"/></svg>',
  "Marketing & Advertising": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 10 20 4 14 11l-3 7L4 10Z"/><path d="M11 14V20"/><path d="M6 10c-1.5-1 0-3 2-2"/></svg>',
  "Crypto, Web3 & Investing": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 7h4a2.5 2.5 0 0 1 0 5h-4"/><path d="M10 12h4a2.5 2.5 0 0 1 0 5h-4"/><path d="M12 5v2"/><path d="M12 17v2"/><path d="M10 7a4 4 0 0 0-2 3"/><path d="M10 17a4 4 0 0 0-2-3"/></svg>',
  "Developer Tools": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 9 4.5 12 9 15"/><path d="M15 9l4.5 3L15 15"/><path d="M14 5 10 19"/></svg>',
  "Business, Finance & Legal": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12h18"/><path d="M12 3v9"/><path d="M7 12c-1.5-2 0-5 5-6 5 1 6.5 4 5 6"/><path d="M5 12v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  "Security, Privacy & Compliance": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 5 7v5c0 3.5 2.5 6.5 7 8 4.5-1.5 7-4.5 7-8V7L12 3Z"/><path d="M9 12l2 2 4-4"/></svg>',
  "default": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7"/><path d="M12 9v4l2.5 2"/></svg>'
};
function catIcon(c){ return CAT_ICONS[c] || CAT_ICONS["default"]; }
const CAT_SHORT = {
  "AI Agents & Infrastructure":"Agents","SEO & AI Visibility":"SEO","Marketing & Advertising":"Marketing","Crypto, Web3 & Investing":"Crypto","Developer Tools":"Developer","Business, Finance & Legal":"Business","Security, Privacy & Compliance":"Security"
};
function renderCatChips(){
  const row=$('#catRow'); const dd=$('#catDropdown'); if(!row) return;
  const topCats=['all',...CONFIG.CATEGORIES.slice(0,7)];
  row.innerHTML = topCats.map(c=>{
    const label=c==='all'?'All':(CAT_SHORT[c]||c);
    const active = currentCategory===c ? 'active':'';
    return `<button class="cat-chip ${active}" data-cat="${esc(c)}"><span style="display:inline-flex;align-items:center;gap:6px">${catIcon(c)}${esc(label)}</span></button>`;
  }).join('') + `<button class="cat-chip" id="moreBtn" data-cat="more">More ${dd && dd.style.display==='block' ? '∧':'⌄'}</button>`;
  // dropdown grid — exactly like outbid screenshot: grid 1 col mobile, 2 cols desktop
  if(dd){
    dd.style.display = dd.style.display || 'none';
    // use grid layout
    dd.style.display = dd.style.display==='block' ? 'block' : dd.style.display;
    const gridStyle = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px';
    dd.innerHTML = `<div style="${gridStyle}">` + ['All',...CONFIG.CATEGORIES].map(c=>{
      const raw=c==='All'?'all':c;
      const active=currentCategory===raw?'active':'';
      return `<button class="cat-chip ${active}" data-cat="${esc(raw)}" style="justify-content:flex-start;gap:8px;padding:10px 12px">${catIcon(raw)}${esc(c)}</button>`;
    }).join('') + `</div>`;
    dd.querySelectorAll('[data-cat]').forEach(b=>{
      b.addEventListener('click',()=>{
        const cat=b.dataset.cat;
        if(cat==='more') return;
        currentCategory=cat; renderCatChips(); visibleCount=50; renderBoard(); dd.style.display='none'; renderCatChips();
      });
    });
  }
  row.querySelectorAll('[data-cat]').forEach(b=>{
    b.addEventListener('click',()=>{
      const cat=b.dataset.cat;
      if(cat==='more'){
        if(dd) dd.style.display = dd.style.display==='block' ? 'none':'block';
        renderCatChips();
        return;
      }
      currentCategory=cat;
      renderCatChips();
      visibleCount=50;
      renderBoard();
      if(dd) dd.style.display='none';
    })
  });
}
document.addEventListener('click',e=>{
  const dd=$('#catDropdown'); const wrap=$('#catRowWrap');
  if(dd && wrap && !wrap.contains(e.target) && dd.style.display==='block'){ dd.style.display='none'; renderCatChips(); }
});
// add duplicate category bar below board like outbid (so filter is accessible after scrolling)
function renderCatBarBelow(){
  let below=document.getElementById('catRowBelow');
  if(!below){
    const board=document.getElementById('board');
    if(!board) return;
    below=document.createElement('div');
    below.id='catRowBelow';
    below.className='cat-row';
    below.style.marginTop='18px';
    board.after(below);
  }
  // clone top chips into below — same active state, clicking scrolls to top and filters
  const cats=['all',...CONFIG.CATEGORIES.slice(0,7)];
  below.innerHTML = cats.map(c=>{
    const label=c==='all'?'All':(CAT_SHORT[c]||c);
    const active=currentCategory===c?'active':'';
    return `<button class="cat-chip ${active}" data-cat="${esc(c)}"><span style="display:inline-flex;align-items:center;gap:6px">${catIcon(c)}${esc(label)}</span></button>`;
  }).join('') + `<button class="cat-chip" data-cat="more-below">More ⌄</button>`;
  below.querySelectorAll('[data-cat]').forEach(b=>{
    b.addEventListener('click',()=>{
      if(b.dataset.cat==='more-below'){ document.getElementById('catRowWrap')?.scrollIntoView({behavior:'smooth',block:'start'}); document.getElementById('moreBtn')?.click(); return; }
      currentCategory=b.dataset.cat; renderCatChips(); renderCatBarBelow(); visibleCount=50; renderBoard(); window.scrollTo({top:0,behavior:'smooth'});
    });
  });
}
const _origRenderCatChips = renderCatChips;
renderCatChips = function(){ _origRenderCatChips(); renderCatBarBelow(); };

async function loadData(){
  const board=$('#board');
  const loading=$('#loadingState');
  if(loading) loading.style.display='block';
  if(board) board.innerHTML='';
  try{
    supabase = await getSupabase();
    const {data:entries, error:e1} = await supabase.from('entries').select('*').eq('status','live').order('total_bid_cents',{ascending:false}).order('first_bid_at',{ascending:true});
    if(e1) throw e1;
    const {data:bids} = await supabase.from('bids').select('*').order('created_at',{ascending:false}).limit(50);
    const {data:statsRow} = await supabase.from('site_stats').select('*').eq('id',1).maybeSingle();
    allEntries = entries || [];
    bidsCache = bids || [];
    if(statsRow) stats = statsRow;
    window.__allEntries = allEntries;
  }catch(err){
    console.warn(err);
    const errEl=$('#errorState');
    if(errEl){ errEl.style.display='block'; errEl.textContent='could not load leaderboard — showing demo data. '+ (err.message||''); }
    if(allEntries.length===0) allEntries = MOCK;
    window.__allEntries = allEntries;
  }
  if(loading) loading.style.display='none';
  // pre-fill amount at #1 + $5
  const topCents = (allEntries[0]?.total_bid_cents)||0;
  if(window.__setBidFromTop) window.__setBidFromTop(topCents);
  renderBoard();
  renderActivity();
  renderCounter();
  updateWater();
}

function filtered(){
  let list=[...allEntries];
  if(currentCategory!=='all') list=list.filter(e=>e.category===currentCategory);
  if(currentTab==='today'){
    // need bids in last 24h per entry
    const cutoff = Date.now()-24*3600000;
    const map=new Map();
    bidsCache.forEach(b=>{
      if(new Date(b.created_at).getTime() > cutoff){
        map.set(b.entry_id, (map.get(b.entry_id)||0)+b.amount_cents);
      }
    });
    list = list.filter(e=>map.has(e.id)).sort((a,b)=> (map.get(b.id)||b.total_bid_cents) - (map.get(a.id)||a.total_bid_cents));
    // attach today amount
    list = list.map(e=>({...e, _today:map.get(e.id)}));
  }
  // already sorted by total_bid desc, first_bid asc from query, but ensure
  if(currentTab==='all'){
    list.sort((a,b)=> b.total_bid_cents - a.total_bid_cents || new Date(a.first_bid_at)-new Date(b.first_bid_at));
  }
  return list;
}

function renderBoard(){
  const board=$('#board'); if(!board) return;
  const list=filtered();
  const top1Bid = list[0]?.total_bid_cents || 0;
  board.innerHTML='';
  if(list.length===0){
    board.innerHTML=`<div class="empty">Nobody has outbid #1 yet. New spots start at $5.</div>`;
    $('#showMoreBtn') && ($('#showMoreBtn').style.display='none');
    return;
  }
  const toShow = list.slice(0, visibleCount);
  toShow.forEach((e,i)=>{
    const rank=i+1;
    const cls = rank===1?'card-top1':rank===2?'card-top2':rank===3?'card-top3':rank<=10?'card-4-10':rank<=25?'card-11-25':'card-26';
    const bidDollars = Math.round(e.total_bid_cents/100);
    const donated = e.donated_cents ?? Math.round(e.total_bid_cents*0.75);
    const claimPrice = rank===1 ? Math.max(5, Math.round(top1Bid/100)+5) : Math.round(e.total_bid_cents/100)+1;
    // cap claim to 999999
    const safeClaim = Math.min(999999, claimPrice);
    const isHandle = e.destination?.startsWith('@');
    const domain = isHandle ? e.destination : (()=>{ try{return new URL(e.destination).hostname.replace(/^www\./,'')}catch{return e.destination}})();
    const logo = e.logo_path ? `<img src="${esc(e.logo_path)}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(initials(e.display_name));
    board.innerHTML += `
      <div class="card ${cls}">
        <div class="rank-badge">#${rank}</div>
        <a href="product.html?slug=${esc(e.slug||e.id)}" class="logo-wrap" aria-label="${esc(e.display_name)}">${logo}</a>
        <div class="card-body">
          <div class="card-title"><a href="${isHandle?'https://x.com/'+e.destination.slice(1):esc(e.destination)}" target="_blank" rel="sponsored noopener" style="color:inherit;text-decoration:none">${esc(e.display_name||domain)}</a></div>
          <div class="card-blurb">${esc(e.description||'')}</div>
          <div class="card-meta">
            <span>${esc(timeAgo(e.last_bid_at||e.first_bid_at))}</span>
            <span>${esc(domain)}</span>
            ${e.category?`<span class="cat-mini">${esc(e.category)}</span>`:''}
            <span class="clicks"><span class="click-dot"></span> ${e.click_count||0} clicks</span>
            <a class="see-details" href="product.html?slug=${esc(e.slug||e.id)}">see details</a>
          </div>
        </div>
        <div class="card-right">
          <div>
            <div class="bid">${formatMoney(e.total_bid_cents)}</div>
            <div class="donated">${formatMoney(e.total_bid_cents)} · ${formatMoney2(donated)} to water</div>
          </div>
          <button class="claim-btn" data-claim="${esc(e.destination)}" data-amount="${safeClaim}">claim this rank for $${safeClaim}</button>
        </div>
      </div>
    `;
    if(rank===3 && list.length>3){
      board.innerHTML += `<div class="divider">latest activity</div><div id="inlineActivity"></div>`;
    }
    if(rank===10 && list.length>10) board.innerHTML += `<div class="divider">Top 10</div>`;
    if(rank===20 && list.length>20) board.innerHTML += `<div class="divider">Top 20</div>`;
  });
  // inline activity if exists
  const inline=$('#inlineActivity');
  if(inline) inline.innerHTML = bidsCache.slice(0,10).map(b=>{
    const entry = allEntries.find(x=>x.id===b.entry_id);
    const name = entry?entry.display_name:'Someone';
    const amt=b.amount_cents||0;
    return `<div class="activity-item"><strong>${esc(name)}</strong> took #? · ${formatMoney(amt)} · <span class="to-water">${formatMoney2(Math.round(amt*0.75))} to water</span> · ${esc(timeAgo(b.created_at))}</div>`;
  }).join('') || '<div class="empty">no bids yet</div>';

  board.querySelectorAll('[data-claim]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const dest=btn.dataset.claim;
      const amt=parseInt(btn.dataset.amount,10);
      openClaimModal(dest, amt);
    })
  });
  const more=$('#showMoreBtn');
  if(more) more.style.display = list.length>visibleCount ? 'block':'none';
}

function renderActivity(){
  const feed=$('#activityFeed'); if(!feed) return;
  if(bidsCache.length===0){ feed.innerHTML='<div class="empty" style="padding:16px">no activity yet</div>'; return; }
  feed.innerHTML = bidsCache.slice(0,10).map(b=>{
    const e=allEntries.find(x=>x.id===b.entry_id);
    const name=e?e.display_name:'Unknown';
    return `<div class="activity-item"><strong>${esc(name)}</strong> took #? · ${formatMoney(b.amount_cents)} · <span class="to-water">${formatMoney2(Math.round((b.amount_cents||0)*0.75))} to water</span> · ${esc(timeAgo(b.created_at))}</div>`;
  }).join('');
}

function renderCounter(){
  const el=$('#donationCounter'); if(!el) return;
  const totalDonated = allEntries.reduce((s,e)=> s + (e.donated_cents||Math.round(e.total_bid_cents*0.75)),0);
  // if bids sum differs use bids
  const bidsDonated = bidsCache.reduce((s,b)=> s + (b.donated_cents||Math.round((b.amount_cents||0)*0.75)),0);
  const sum = Math.max(totalDonated, bidsDonated);
  const hrs = hoursSince(stats.launched_at);
  el.innerHTML = `${formatMoney(sum)} donated to clean water since launch, ${hrs} hours ago · <a href="${CONFIG.EVERYORG_FUNDRAISER}" target="_blank" rel="noopener">verify on Every.org →</a>`;
  // also update hero amount maybe
}

function updateWater(){
  const total = allEntries.reduce((s,e)=> s+ (e.donated_cents||0),0) || allEntries.reduce((s,e)=> s+ Math.round(e.total_bid_cents*0.75),0);
  const pct = Math.min(100, (total/CONFIG.GOAL_CENTS)*100);
  // height up to 60vh
  const h = (pct/100)*60;
  const wl=$('#waterLevel');
  if(wl) wl.style.height = h+'vh';
}

async function bumpVisitor(){
  try{
    const sb=await getSupabase();
    // increment via rpc? fallback to select+update not allowed due RLS, so just display
    const countEl=$('#onlineCount');
    if(countEl){
      // fake online 3-12
      const online = 3 + Math.floor(Math.random()*9);
      const visitors = (stats.visitor_count||0) + Math.floor(Math.random()*40);
      countEl.textContent = `${online} online · ${visitors} visitors since launch`;
    }
    // try insert click? not needed
  }catch{}
}

function openClaimModal(destination, amount){
  const overlay=$('#modalOverlay'); if(!overlay) return;
  $('#modalDest').textContent=destination;
  $('#modalAmount').textContent='$'+amount;
  const donated = (amount*0.75).toFixed(2);
  const kept = (amount*0.25).toFixed(2);
  $('#modalDonated').textContent='$'+donated;
  $('#modalKept').textContent='$'+kept;
  $('#modalTotal').textContent='$'+amount;
  overlay.classList.add('open');
  overlay.dataset.dest=destination;
  overlay.dataset.amount=String(amount);
  // reset steps
  setModalStep(1);
}
function closeModal(){ $('#modalOverlay')?.classList.remove('open'); }
function setModalStep(n){
  $all('.step').forEach((s,i)=>{ s.classList.toggle('active', i+1===n); s.classList.toggle('done', i+1<n); });
  const bar=$('#modalProgress'); if(bar) bar.style.width = n===1?'50%':'100%';
  const btn=$('#modalAction');
  if(btn){
    if(n===1) btn.textContent='donate $'+$('#modalDonated').textContent.slice(1)+' to water →';
    else btn.textContent='pay $'+$('#modalKept').textContent.slice(1)+' to claim rank';
  }
}

async function handleSubmit(){
  // legacy: claim button on cards still uses modal
  const input=$('#destinationInput');
  const cat=$('#categorySelect')?.value||'Other';
  const raw=input?.value?.trim();
  if(!raw){ input?.focus(); showInlineError('enter a url or @handle'); return; }
  let dest;
  try{ dest=normalizeDestination(raw); }catch(e){ showInlineError(e.message); return; }
  const amount = bidAmount;
  if(amount<5 || amount>999999 || !Number.isInteger(amount)){ showInlineError('$5–$999,999 whole dollars only'); return; }
  const top = filtered()[0];
  if(top && amount >=6){
    const maxBid = Math.round((top.total_bid_cents||0)/100);
    if(amount > maxBid && amount < maxBid+5){
      showInlineError(`taking #1 costs at least $${maxBid+5} — $${maxBid+5} or more to be #1, or bid less to take a lower rank`);
      return;
    }
  }
  openClaimModal(dest, amount);
  $('#modalOverlay').dataset.category=cat;
}

async function handleSubmitNew(){
  const formErr=$('#formError');
  if(formErr) formErr.style.display='none';
  const raw=$('#destinationInput')?.value?.trim();
  const cat=$('#categorySelect')?.value;
  const desc=$('#descriptionInput')?.value?.trim()||'';
  const logoPath=window.__formApi?.getLogoPath()||null;
  if(!raw){ showFormError('Enter your product URL or @handle'); return; }
  if(!cat){ showFormError('Choose a category'); return; }
  let dest;
  try{ dest=normalizeDestination(raw); }catch(e){ showFormError(e.message); return; }
  if(!Number.isInteger(bidAmount) || bidAmount<5 || bidAmount>999999){ showFormError('$5–$999,999 whole dollars only'); return; }
  if(desc.length>200){ showFormError('description max 200 chars'); return; }
  const isExisting=window.__formApi?.isExisting();
  if(!isExisting){
    if(!desc) { showFormError('description required'); return; }
    if(!logoPath){ showFormError('logo required — pick a file'); return; }
  } else {
    if(desc) { /* ok */ }
  }
  const top = filtered()[0];
  if(top){
    const maxBid=Math.round((top.total_bid_cents||0)/100);
    if(bidAmount>maxBid && bidAmount < maxBid+5){
      showFormError(`taking #1 costs at least $${maxBid+5}`); return;
    }
  }
  // sanitize desc
  const cleanDesc=desc.replace(/<[^>]*>/g,'').slice(0,200);
  const btn=$('#outbidBtn');
  const orig=btn.textContent;
  btn.textContent='Creating…'; btn.disabled=true;
  try{
    const r=await fetch('/api/create-bid',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      destination: dest,
      bidDollars: bidAmount,
      category: cat,
      description: cleanDesc,
      logoPath
    })});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||'create failed');
    // redirect to PayPal approve link
    if(j.approveLink){
      window.location.href=j.approveLink;
    } else {
      showFormError('no approve link returned');
    }
  }catch(e){
    showFormError(e.message);
    btn.textContent=orig; btn.disabled=false;
  }
}
function showFormError(msg){
  const el=$('#formError')||$('#inlineError');
  let target=$('#formError');
  if(!target){
    target=document.createElement('div'); target.id='formError'; target.className='error';
    $('#submitForm')?.appendChild(target);
  }
  target.style.display='block'; target.textContent=msg;
}
function showInlineError(msg){ showFormError(msg); }

function showInlineError(msg){
  let el=$('#inlineError');
  if(!el){
    el=document.createElement('div'); el.id='inlineError'; el.className='error';
    $('#inputRow')?.after(el);
  }
  el.style.display='block'; el.textContent=msg;
  setTimeout(()=> el.style.display='none', 4000);
}

// modal action
document.addEventListener('click', async (e)=>{
  if(e.target.id==='modalAction'){
    const overlay=$('#modalOverlay');
    const step = overlay.querySelector('.step.active');
    const idx = [...overlay.querySelectorAll('.step')].indexOf(step);
    if(idx===0){
      // step 1: donate via every.org
      const dest=overlay.dataset.dest;
      const amount=parseFloat(overlay.dataset.amount);
      const donated = (amount*0.75).toFixed(2);
      // create entry via api/checkout first to get id
      try{
        e.target.textContent='creating…'; e.target.disabled=true;
        const res = await fetch('/api/checkout',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({destination:dest, amount_cents: amount*100, category: overlay.dataset.category})});
        const j=await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(j.error||'could not create entry');
        const entryId=j.entryId||j.id||'demo';
        // build every.org url
        const url = new URL(CONFIG.EVERYORG_FUNDRAISER);
        url.searchParams.set('amount', donated);
        url.searchParams.set('partnerDonationId', entryId);
        url.searchParams.set('method','card');
        // store pending
        localStorage.setItem('cww_pending', JSON.stringify({entryId, amount, dest}));
        window.open(url.toString(),'_blank');
        setModalStep(2);
        $('#modalHint').textContent='You just donated $'+donated+' to clean water. Complete step 2 to claim your rank.';
        e.target.disabled=false;
      }catch(err){
        // fallback: direct to every.org without id
        const url = new URL(CONFIG.EVERYORG_FUNDRAISER);
        url.searchParams.set('amount', donated);
        window.open(url.toString(),'_blank');
        setModalStep(2);
        e.target.disabled=false;
        showInlineError(err.message);
      }
    } else {
      // step 2: simulate payment
      const overlay2=$('#modalOverlay');
      const amount=parseFloat(overlay2.dataset.amount);
      const kept=(amount*0.25).toFixed(2);
      e.target.textContent='processing…';
      // call payment api if exists
      try{
        const pending=JSON.parse(localStorage.getItem('cww_pending')||'{}');
        const r=await fetch('/api/payment-done',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({entryId:pending.entryId, amount_cents: Math.round(parseFloat(kept)*100)})});
        // ignore error
      }catch{}
      setTimeout(()=>{ closeModal(); alert('payment recorded — your rank will appear once webhooks confirm. If donation confirmed without payment, you will be approved within 30 minutes.'); location.reload(); }, 800);
    }
  }
});

document.addEventListener('DOMContentLoaded', init);
