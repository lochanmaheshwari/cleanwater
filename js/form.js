import { normalizeDestination, esc } from './utils.js';
import { CONFIG } from './config.js';

let logoPath = null;
let logoUploadedAt = null;
let pendingLogoFile = null;
let logoDataUrl = null;

function $(s) { return document.querySelector(s); }

export function initForm(getBidAmount, getTopBidCents) {
  // description counter
  const desc = $('#descriptionInput');
  const cnt = $('#descCount');
  if (desc && cnt) {
    desc.addEventListener('input', () => {
      cnt.textContent = String(desc.value.length);
      desc.style.borderColor = desc.value.length > 100 ? '#ef4444' : '';
    });
  }

  // logo drag & drop + file picker
  const drop = $('#logoDrop');
  const input = $('#logoInput');
  const preview = $('#logoPreview');
  const err = $('#logoError');

  if (drop && input) {
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.style.borderColor = 'var(--accent)';
    });
    drop.addEventListener('dragleave', () => {
      drop.style.borderColor = '';
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.style.borderColor = '';
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) handleFile(input.files[0]);
    });
  }

  async function handleFile(file) {
    const errEl = $('#logoError');
    if (errEl) errEl.style.display = 'none';

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|svg)$/i)) {
      if (errEl) {
        errEl.textContent = 'png, jpg, webp, svg only';
        errEl.style.display = 'block';
      }
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      if (errEl) {
        errEl.textContent = 'max 5MB';
        errEl.style.display = 'block';
      }
      return;
    }

    const previewEl = $('#logoPreview');

    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = async () => {
        logoDataUrl = reader.result;
        if (previewEl) {
          previewEl.innerHTML = `<img src="${logoDataUrl}" style="width:100%;height:100%;object-fit:cover">`;
        }
        await uploadLogo(file, logoDataUrl);
      };
      reader.readAsDataURL(file);
    } else {
      // Resize to 400x400 canvas and convert to WebP
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          const scale = Math.max(400 / img.width, 400 / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (400 - w) / 2;
          const y = (400 - h) / 2;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 400, 400);
          ctx.drawImage(img, x, y, w, h);

          logoDataUrl = canvas.toDataURL('image/webp', 0.85);
          if (previewEl) {
            previewEl.innerHTML = `<img src="${logoDataUrl}" style="width:100%;height:100%;object-fit:cover">`;
          }

          canvas.toBlob(async (blob) => {
            const webpFile = new File([blob], 'logo.webp', { type: 'image/webp' });
            pendingLogoFile = webpFile;
            await uploadLogo(webpFile, logoDataUrl);
          }, 'image/webp', 0.85);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  }

  async function uploadLogo(file, dataUrl) {
    try {
      const errEl = $('#logoError');
      if (errEl) errEl.style.display = 'none';

      // Send direct base64 dataUrl + metadata to logo-upload API
      const r = await fetch('/api/logo-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileData: dataUrl
        })
      });

      const j = await r.json().catch(() => ({}));
      if (r.ok && j.path) {
        logoPath = j.path;
        logoUploadedAt = Date.now();
        return;
      }

      // If API returned a signedUrl instead
      if (j.signedUrl) {
        const put = await fetch(j.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file
        });
        if (put.ok) {
          logoPath = j.path;
          logoUploadedAt = Date.now();
          return;
        }
      }

      // If running on static host / local preview without serverless API, store client fallback
      logoPath = `pending/${Date.now()}-client.webp`;
      logoUploadedAt = Date.now();
    } catch (e) {
      console.warn('logo upload fallback', e);
      // Ensure user is not blocked even if offline/local preview
      logoPath = `pending/${Date.now()}-client.webp`;
      logoUploadedAt = Date.now();
    }
  }

  // Destination input change → check existing entry
  const destInput = $('#destinationInput');
  if (destInput) {
    let t = null;
    destInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(checkExisting, 400);
    });
    destInput.addEventListener('blur', checkExisting);
  }

  async function checkExisting() {
    const raw = $('#destinationInput')?.value?.trim();
    if (!raw) return hideExisting();
    let dest;
    try {
      dest = normalizeDestination(raw);
    } catch {
      return hideExisting();
    }
    try {
      const r = await fetch(`/api/check-existing?destination=${encodeURIComponent(dest)}`);
      const j = await r.json();
      if (j.exists) {
        showExisting(j.entry);
      } else {
        hideExisting();
      }
    } catch {
      hideExisting();
    }
  }

  function showExisting(entry) {
    const hint = $('#existingHint');
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = `Already on the list — this adds to your total. Current: $${(entry.total_bid_cents / 100).toFixed(0)} · ${entry.description || ''}`;
    }
  }

  function hideExisting() {
    const h = $('#existingHint');
    if (h) h.style.display = 'none';
  }

  return {
    getLogoPath: () => logoPath,
    getLogoDataUrl: () => logoDataUrl,
    getDescription: () => $('#descriptionInput')?.value?.trim() || '',
    isExisting: () => $('#existingHint')?.style.display === 'block',
    resetLogo: () => {
      logoPath = null;
      logoDataUrl = null;
      pendingLogoFile = null;
      const p = $('#logoPreview');
      if (p) p.innerHTML = '≋';
    }
  };
}
