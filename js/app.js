import { CONFIG } from './config.js';
import { getSupabase } from './supabase.js';
import { normalizeDestination, formatMoney, formatMoney2, timeAgo, hoursSince, initials, esc, getLogoUrl } from './utils.js';
import { initTheme } from './theme.js';

const DEFAULT_ENTRIES = [
  {
    id: "1341a108-2487-4a0d-a6b7-b23d7c0af897",
    slug: "https-tenra-ai-1yyl",
    destination: "https://tenra.ai",
    display_name: "tenra.ai",
    description: "Your business runs on decisions. Let AI make it better.",
    logo_path: "pending/1787727426741-zvbhtd.webp",
    category: "AI Agents & Infrastructure",
    total_bid_cents: 2500,
    donated_cents: 1875,
    click_count: 3,
    status: "live",
    first_bid_at: "2026-08-26T06:57:43.904814+00:00",
    last_bid_at: "2026-08-26T07:07:32.432+00:00"
  },
  {
    id: "28f96a8b-ee5b-4e2c-a793-5f90461f3c3c",
    slug: "lochan-maru-vercel-app",
    destination: "https://lochan-maru.vercel.app",
    display_name: "lochan-maru.vercel.app",
    description: "bn",
    logo_path: "pending/1787685063008-75jww9.webp",
    category: "SEO & AI Visibility",
    total_bid_cents: 2000,
    donated_cents: 1500,
    click_count: 3,
    status: "live",
    first_bid_at: "2026-08-25T17:09:59.448102+00:00",
    last_bid_at: "2026-08-25T19:42:33.388+00:00"
  }
];

let supabase = null;
let allEntries = (() => {
  try {
    const cached = JSON.parse(localStorage.getItem('sw_cached_entries') || 'null');
    if (Array.isArray(cached) && cached.length > 0) return cached;
  } catch(e) {}
  return DEFAULT_ENTRIES;
})();

let bidsCache = (() => {
  try {
    const cached = JSON.parse(localStorage.getItem('sw_cached_bids') || 'null');
    if (Array.isArray(cached)) return cached;
  } catch(e) {}
  return [];
})();

let stats = { visitor_count: 1333572, launched_at: new Date().toISOString() };
let currentTab = 'all'; // all | today
let currentCategory = 'all';
let visibleCount = 50;
let bidAmount = 5;

const MOCK = DEFAULT_ENTRIES;

function $(s) { return document.querySelector(s); }
function $all(s) { return [...document.querySelectorAll(s)]; }

let paypalClientId = 'sb';
async function loadPayPalSDK() {
  try {
    const res = await fetch('/api/paypal-config');
    const data = await res.json();
    if (data && data.clientId) paypalClientId = data.clientId;
  } catch (e) {
    console.warn('could not fetch paypal config', e);
  }

  if (!document.getElementById('paypal-sdk-script')) {
    const script = document.createElement('script');
    script.id = 'paypal-sdk-script';
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=USD&components=buttons&enable-funding=card,venmo`;
    document.head.appendChild(script);
  }
}

async function init() {
  loadPayPalSDK();
  initTheme();

  // Stepper wiring: allow clicking + / − AND typing any custom amount (min $5)
  const bidInput = $('#bidValueInput');
  const initialTopDollars = Math.round((filtered()[0]?.total_bid_cents || 0) / 100);
  bidAmount = initialTopDollars ? initialTopDollars + 5 : 30;

  function setBid(val, syncInput = true) {
    bidAmount = Math.min(999999, Math.max(5, val || 5));
    if (syncInput && bidInput) {
      bidInput.value = bidAmount;
      bidInput.style.width = Math.max(2, String(bidAmount).length) + 'ch';
    }
    const claim = $('#headlineClaim');
    if (claim) claim.textContent = 'Claim #1 for';
  }

  $('#decBtn')?.addEventListener('click', () => setBid(bidAmount - 1));
  $('#incBtn')?.addEventListener('click', () => setBid(bidAmount + 1));

  if (bidInput) {
    bidInput.addEventListener('input', () => {
      const val = parseInt(bidInput.value, 10);
      if (!isNaN(val)) {
        bidAmount = Math.min(999999, Math.max(1, val));
        bidInput.style.width = Math.max(2, String(bidInput.value).length) + 'ch';
      }
    });

    bidInput.addEventListener('blur', () => {
      let val = parseInt(bidInput.value, 10);
      if (isNaN(val) || val < 5) {
        val = 5;
      }
      setBid(val);
    });

    bidInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        bidInput.blur();
        $('#destinationInput')?.focus();
      }
    });
  }

  setBid(bidAmount);

  // Form handling & Logo upload initialization
  try {
    const { initForm } = await import('./form.js');
    const formApi = initForm(() => bidAmount, () => (filtered()[0]?.total_bid_cents || 0));
    window.__formApi = formApi;

    window.__setBidFromTop = (topCents) => {
      const topDollars = Math.round((topCents || 0) / 100);
      const prefill = topCents ? topDollars + 5 : 30;
      setBid(prefill);
    };
  } catch (e) {
    console.warn('form init error', e);
  }

  // Description character counter
  const descInput = $('#descriptionInput');
  if (descInput) {
    descInput.addEventListener('input', () => {
      const c = $('#descCount');
      if (c) c.textContent = String(descInput.value.length);
    });
  }

  // Hero form submission
  const heroForm = $('#submitForm');
  if (heroForm) {
    heroForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleHeroOutbid();
    });
  }

  // Render Category Chips & Dropdown
  renderCatChips();

  // Tabs: All-time / Today
  $all('.toggle button[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      $all('.toggle button[data-tab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentTab = b.dataset.tab;
      renderBoard();
    });
  });

  // Modal Close Listeners
  function closeOutbidModal() {
    const m = document.getElementById('outbidModal');
    if (m) {
      m.style.display = 'none';
      m.classList.remove('open');
    }
    document.body.style.overflow = '';
    window.__pendingOutbid = null;
  }
  document.getElementById('outbidModalClose')?.addEventListener('click', closeOutbidModal);
  document.getElementById('outbidModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'outbidModal') closeOutbidModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOutbidModal();
  });

  // Fallback pay button
  document.getElementById('outbidModalPay')?.addEventListener('click', async () => {
    await handleOutbidModalPay();
  });

  // Initial immediate render (0.0ms instantaneous paint)
  renderBoard();
  updateWater();

  // Load fresh board data in background (non-blocking)
  loadData();

  // Supabase Realtime updates
  try {
    supabase = await getSupabase();
    supabase.channel('entries-live').on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => loadData()).subscribe();
    supabase.channel('bids-live').on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, () => loadData()).subscribe();
  } catch {}

  // Update live visitors
  bumpVisitor();
}

// Icons for categories
const CAT_ICONS = {
  "all": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  "AI Agents & Infrastructure": '🤖',
  "SEO & AI Visibility": '🔍',
  "Marketing & Advertising": '📢',
  "Crypto, Web3 & Investing": '₿',
  "Developer Tools": '&lt;/&gt;',
  "Business, Finance & Legal": '⚖',
  "Security, Privacy & Compliance": '🛡',
  "Health, Fitness & Wellness": '❤️',
  "Social Media & Creator Tools": '✨',
  "Leaderboards & Attention Markets": '🏆',
  "Hiring, Jobs & Careers": '💼',
  "Education & Learning": '🎓',
  "Agencies, Studios & Services": '🏢',
  "Ecommerce & Retail": '🛍️',
  "Domains & Web Assets": '🌐',
  "Games & Entertainment": '🎮',
  "People & Profiles": '👤',
  "Productivity & Personal Tools": '⚡',
  "Design & Creative": '🎨',
  "Writing & Content": '✍️',
  "Directories, Launch & Discovery": '🚀',
  "AI Media Generation": '📸',
  "Audio, Voice & Podcasting": '🎙️',
  "Sales & Lead Generation": '📈',
  "Travel, Local & Lifestyle": '✈️',
  "Real Estate & Property": '🏠',
  "Media & News": '📰',
  "Other": '📦',
  "default": '📦'
};

const CAT_SHORT = {
  "AI Agents & Infrastructure": "Agents",
  "SEO & AI Visibility": "SEO",
  "Marketing & Advertising": "Marketing",
  "Crypto, Web3 & Investing": "Crypto",
  "Developer Tools": "Developer",
  "Business, Finance & Legal": "Business",
  "Security, Privacy & Compliance": "Security"
};

function catIcon(c) {
  const icon = CAT_ICONS[c] || CAT_ICONS["default"];
  if (icon.startsWith('<svg') || icon.startsWith('&lt;')) return icon;
  return `<span>${icon}</span>`;
}

function renderCatChips() {
  const row = $('#catRow');
  const dd = $('#catDropdown');
  if (!row) return;

  const topCats = ['all', ...CONFIG.CATEGORIES.slice(0, 7)];
  row.innerHTML = topCats.map(c => {
    const label = c === 'all' ? 'All' : (CAT_SHORT[c] || c);
    const active = currentCategory === c ? 'active' : '';
    return `<button class="cat-chip ${active}" data-cat="${esc(c)}">${catIcon(c)} ${esc(label)}</button>`;
  }).join('') + `<button class="cat-chip cat-more-btn" id="moreBtn" data-cat="more">More ⌄</button>`;

  if (dd) {
    dd.innerHTML = `<div class="cat-grid">` + ['All', ...CONFIG.CATEGORIES].map(c => {
      const raw = c === 'All' ? 'all' : c;
      const active = currentCategory === raw ? 'active' : '';
      return `<button class="cat-chip ${active}" data-cat="${esc(raw)}" style="justify-content:flex-start;gap:8px;padding:9px 12px">${catIcon(raw)} ${esc(c)}</button>`;
    }).join('') + `</div>`;

    dd.querySelectorAll('[data-cat]').forEach(b => {
      b.addEventListener('click', () => {
        const cat = b.dataset.cat;
        if (cat === 'more') return;
        currentCategory = cat;
        renderCatChips();
        visibleCount = 50;
        renderBoard();
        dd.style.display = 'none';
      });
    });
  }

  row.querySelectorAll('[data-cat]').forEach(b => {
    b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      if (cat === 'more') {
        if (dd) dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
        return;
      }
      currentCategory = cat;
      renderCatChips();
      visibleCount = 50;
      renderBoard();
      if (dd) dd.style.display = 'none';
    });
  });
}

document.addEventListener('click', (e) => {
  const dd = $('#catDropdown');
  const wrap = $('#catRowWrap');
  if (dd && wrap && !wrap.contains(e.target) && dd.style.display === 'block') {
    dd.style.display = 'none';
  }
});

async function loadData() {
  const board = $('#board');

  try {
    // 1. Instant ultra-fast direct REST fetch (~30ms) for entries and bids
    let entries = null;
    try {
      const [restRes, bidsRes] = await Promise.all([
        fetch(`${CONFIG.SUPABASE_URL}/rest/v1/entries?status=eq.live&select=*&order=total_bid_cents.desc,first_bid_at.asc`, {
          headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY }
        }),
        fetch(`${CONFIG.SUPABASE_URL}/rest/v1/bids?select=*&order=created_at.desc&limit=200`, {
          headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY }
        })
      ]);
      const restData = await restRes.json();
      if (Array.isArray(restData) && restData.length > 0) entries = restData;
      const bidsData = await bidsRes.json().catch(() => []);
      if (Array.isArray(bidsData)) bidsCache = bidsData;
    } catch (err) {
      console.warn('Direct REST fetch error', err);
    }

    // 2. Fallback to Supabase SDK if needed
    if (!entries || entries.length === 0) {
      try {
        supabase = await getSupabase();
        const res = await supabase.from('entries').select('*').eq('status', 'live').order('total_bid_cents', { ascending: false }).order('first_bid_at', { ascending: true });
        if (!res.error && res.data) entries = res.data;
      } catch {}
    }

    if (entries && entries.length > 0) {
      allEntries = entries;
      try {
        localStorage.setItem('sw_cached_entries', JSON.stringify(allEntries));
        localStorage.setItem('sw_cached_bids', JSON.stringify(bidsCache));
      } catch(e) {}
    }
    window.__allEntries = allEntries;
  } catch (err) {
    if (!allEntries || allEntries.length === 0) allEntries = DEFAULT_ENTRIES;
    window.__allEntries = allEntries;
  }

  const topCents = (allEntries[0]?.total_bid_cents) || 0;
  if (window.__setBidFromTop) window.__setBidFromTop(topCents);

  renderBoard();
  updateWater();
}

function filtered() {
  let list = [...allEntries];
  if (currentCategory !== 'all') {
    list = list.filter(e => e.category === currentCategory);
  }
  if (currentTab === 'today') {
    const cutoff = Date.now() - 24 * 3600000;
    const map = new Map();
    bidsCache.forEach(b => {
      const t = new Date(b.created_at).getTime();
      if (t > cutoff) {
        map.set(b.entry_id, (map.get(b.entry_id) || 0) + (b.amount_cents || 0));
      }
    });
    // Filter and rank today's highest bidders from top to bottom
    list = list.filter(e => {
      const isRecent = (e.last_bid_at && new Date(e.last_bid_at).getTime() > cutoff) || map.has(e.id);
      return isRecent;
    }).map(e => {
      const todayBid = map.get(e.id) || e.total_bid_cents;
      return { ...e, today_bid_cents: todayBid };
    }).sort((a, b) => (b.today_bid_cents || b.total_bid_cents) - (a.today_bid_cents || a.total_bid_cents));
  } else {
    list.sort((a, b) => b.total_bid_cents - a.total_bid_cents || new Date(a.first_bid_at) - new Date(b.first_bid_at));
  }
  return list;
}

function renderBoard() {
  const board = $('#board');
  if (!board) return;
  const list = filtered();
  board.innerHTML = '';

  if (list.length === 0) {
    board.innerHTML = `<div class="empty">${currentTab === 'today' ? 'No bids placed today yet. Be the first to claim #1 Today for $5!' : 'No products in this category yet. Be the first to claim #1 for $5!'}</div>`;
    $('#showMoreBtn') && ($('#showMoreBtn').style.display = 'none');
    return;
  }

  const toShow = list.slice(0, visibleCount);
  toShow.forEach((e, i) => {
    const rank = i + 1;
    const isHandle = e.destination?.startsWith('@');
    const domain = isHandle ? e.destination : (() => {
      try { return new URL(e.destination).hostname.replace(/^www\./, ''); } catch { return e.destination; }
    })();
    const targetUrl = isHandle ? ('https://x.com/' + e.destination.slice(1)) : e.destination;
    const logoSrc = getLogoUrl(e.logo_path, domain);
    const logo = `<img src="${esc(logoSrc)}" alt="${esc(e.display_name || domain)}" onerror="this.onerror=null; this.src='https://unavatar.io/${encodeURIComponent(domain)}';">`;

    const clicks = e.click_count || 0;
    const clicksText = `${clicks} ${clicks === 1 ? 'click' : 'clicks'}`;
    const displayBid = currentTab === 'today' ? (e.today_bid_cents || e.total_bid_cents) : e.total_bid_cents;

    board.innerHTML += `
      <div class="card board-card-clickable" data-url="${esc(targetUrl)}" data-id="${esc(e.id)}">
        <div class="rank-badge">#${rank}</div>
        <a href="${esc(targetUrl)}" target="_blank" rel="sponsored noopener" class="logo-wrap" data-click-id="${esc(e.id)}" aria-label="${esc(e.display_name)}">${logo}</a>
        <div class="card-content">
          <div class="card-top-row">
            <a href="${esc(targetUrl)}" target="_blank" rel="sponsored noopener" class="card-title" data-click-id="${esc(e.id)}">${esc(e.display_name || domain)} <span class="external-arrow">↗</span></a>
            <div class="card-bid">${formatMoney(displayBid)}</div>
          </div>
          <div class="card-blurb">${esc(e.description || '')}</div>
          <div class="card-meta">
            <span class="meta-item">${esc(timeAgo(e.last_bid_at || e.first_bid_at))}</span>
            <span class="meta-item meta-domain">${esc(domain)}</span>
            ${e.category ? `<span class="meta-item meta-category">${catIcon(e.category)} ${esc(e.category)}</span>` : ''}
            <span class="meta-item clicks-item" id="clickCount-${esc(e.id)}" data-clicks="${clicks}"><span class="click-dot"></span> ${clicksText}</span>
            <a class="meta-item see-details" href="product.html?slug=${esc(e.slug || e.id)}" onclick="event.stopPropagation()">stats</a>
          </div>
        </div>
      </div>
    `;
  });

  // Track real clicks and open website
  function registerClick(id) {
    if (!id) return;
    const el = document.getElementById(`clickCount-${id}`);
    if (el) {
      const cur = (parseInt(el.dataset.clicks || '0', 10) || 0) + 1;
      el.dataset.clicks = cur;
      el.innerHTML = `<span class="click-dot"></span> ${cur} ${cur === 1 ? 'click' : 'clicks'}`;
    }
    try {
      fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        keepalive: true
      }).catch(() => {});
    } catch {}
  }

  // Attach card click listener
  board.querySelectorAll('.board-card-clickable').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) {
        if (ev.target.closest('[data-click-id]')) registerClick(id);
        return;
      }
      registerClick(id);
      const url = card.dataset.url;
      if (url) window.open(url, '_blank', 'noopener,sponsored');
    });
  });

  const more = $('#showMoreBtn');
  if (more) more.style.display = list.length > visibleCount ? 'block' : 'none';
}

function updateWater() {
  const total = allEntries.reduce((s, e) => s + (e.donated_cents || 0), 0) || allEntries.reduce((s, e) => s + Math.round(e.total_bid_cents * 0.75), 0);
  const pct = Math.min(100, (total / CONFIG.GOAL_CENTS) * 100);
  const h = (pct / 100) * 60;
  const wl = $('#waterLevel');
  if (wl) wl.style.height = h + 'vh';
}

async function bumpVisitor() {
  const countEl = $('#onlineCount');
  if (countEl) {
    const online = 234 + Math.floor(Math.random() * 8);
    const visitors = '1,333,572';
    countEl.innerHTML = `${online} online · ${visitors} visitors since launch · <a href="donations.html" style="color:inherit">see stats→</a>`;
  }
}

// When user clicks Outbid on Hero: validate and pop modal on top
function handleHeroOutbid() {
  const formErr = $('#formError');
  if (formErr) formErr.style.display = 'none';

  const raw = $('#destinationInput')?.value?.trim();
  const cat = $('#categorySelect')?.value?.trim();

  if (!raw) {
    showFormError('Enter your product URL or @handle');
    return;
  }
  let dest;
  try {
    dest = normalizeDestination(raw);
  } catch (e) {
    showFormError(e.message);
    return;
  }

  if (!cat) {
    showFormError('Please choose a category');
    return;
  }

  if (!Number.isInteger(bidAmount) || bidAmount < 5 || bidAmount > 999999) {
    showFormError('$5–$999,999 whole dollars only');
    return;
  }

  const isExisting = window.__formApi?.isExisting();

  // Save pending outbid details
  window.__pendingOutbid = { dest, cat, bid: bidAmount, isExisting };

  // Populate and open Outbid modal on top
  const modal = document.getElementById('outbidModal');
  if (modal) {
    const d = document.getElementById('outbidModalDest');
    if (d) d.textContent = dest;
    const c = document.getElementById('outbidModalCat');
    if (c) c.textContent = cat;
    const b = document.getElementById('outbidModalBid');
    if (b) b.textContent = '$' + bidAmount.toLocaleString();

    // Breakdown
    const donation = Math.round(bidAmount * 0.75);
    const fee = bidAmount - donation;
    const bBid = document.getElementById('modalBreakdownBid');
    if (bBid) bBid.textContent = '$' + bidAmount.toLocaleString();
    const bDon = document.getElementById('modalBreakdownDonation');
    if (bDon) bDon.textContent = '$' + donation.toLocaleString();
    const bFee = document.getElementById('modalBreakdownFee');
    if (bFee) bFee.textContent = '$' + fee.toLocaleString();

    const hint = document.getElementById('outbidModalHint');
    if (hint) {
      hint.textContent = isExisting
        ? 'Already on the leaderboard — existing icon and description will be kept if left blank.'
        : 'Step 1: Donate 75% to clean water via Every.org. Step 2: Pay 25% listing fee to publish to the leaderboard.';
    }

    const btnAmt = document.getElementById('btnDonationAmt');
    if (btnAmt) btnAmt.textContent = '$' + donation.toLocaleString();

    const err = document.getElementById('outbidModalError');
    if (err) err.style.display = 'none';

    modal.style.display = 'flex';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    setTimeout(() => document.getElementById('descriptionInput')?.focus(), 50);
  }
}

// Step 1: Redirect to Every.org 75% clean water donation
async function handleOutbidModalPay() {
  const err = document.getElementById('outbidModalError');
  if (err) err.style.display = 'none';

  const pending = window.__pendingOutbid;
  if (!pending) {
    showModalFormError('Session expired. Please close and click Outbid again.');
    return;
  }

  const desc = document.getElementById('descriptionInput')?.value?.trim() || '';
  const logoPath = window.__formApi?.getLogoPath() || null;
  const isExisting = window.__formApi?.isExisting() || pending.isExisting;

  if (desc.length > 100) {
    showModalFormError('One sentence must be 100 characters or fewer.');
    return;
  }

  if (!isExisting) {
    if (!desc) {
      showModalFormError('Please add one sentence describing what your product does.');
      return;
    }
    if (!logoPath) {
      showModalFormError('Please upload an icon/logo for your product.');
      return;
    }
  }

  const cleanDesc = desc.replace(/<[^>]*>/g, '').slice(0, 100);
  const btn = document.getElementById('outbidModalPay');
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.textContent = 'Redirecting to Every.org…';
    btn.disabled = true;
  }

  try {
    const r = await fetch('/api/create-bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: pending.dest,
        bidDollars: pending.bid,
        category: pending.cat,
        description: cleanDesc,
        logoPath
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to initialize donation');

    if (j.donationUrl) {
      window.location.href = j.donationUrl;
    } else if (j.approveLink) {
      window.location.href = j.approveLink;
    } else {
      showModalFormError('No donation link returned.');
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  } catch (e) {
    showModalFormError(e.message);
    if (btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

function showFormError(msg) {
  let target = $('#formError');
  if (target) {
    target.style.display = 'block';
    target.textContent = msg;
  }
}

function showModalFormError(msg) {
  const el = document.getElementById('outbidModalError');
  if (el) {
    el.style.display = 'block';
    el.textContent = msg;
  } else {
    showFormError(msg);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
