import { normalizeDestination, esc } from './utils.js';
import { CONFIG } from './config.js';

let logoPath=null, logoUploadedAt=null;
let pendingLogoFile=null;

function $(s){return document.querySelector(s)}

export function initForm(getBidAmount, getTopBidCents){
  // description counter
  const desc=$('#descriptionInput'), cnt=$('#descCount');
  if(desc && cnt){
    desc.addEventListener('input',()=>{ cnt.textContent=String(desc.value.length); desc.style.borderColor = desc.value.length>100 ? '#ef4444' : '' });
  }
  // logo
  const drop=$('#logoDrop'), input=$('#logoInput'), preview=$('#logoPreview'), err=$('#logoError');
  if(drop && input){
    drop.addEventListener('click',()=>input.click());
    drop.addEventListener('dragover',e=>{e.preventDefault(); drop.style.borderColor='var(--accent)';});
    drop.addEventListener('dragleave',()=>drop.style.borderColor='');
    drop.addEventListener('drop',e=>{e.preventDefault(); drop.style.borderColor=''; const f=e.dataTransfer.files[0]; if(f) handleFile(f);});
    input.addEventListener('change',()=>{ if(input.files[0]) handleFile(input.files[0]); });
  }
  async function handleFile(file){
    const errEl=$('#logoError');
    if(errEl) errEl.style.display='none';
    const allowed=['image/png','image/jpeg','image/jpg','image/webp','image/svg+xml'];
    if(!allowed.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|svg)$/i)){
      if(errEl){errEl.textContent='png, jpg, webp, svg only'; errEl.style.display='block';}
      return;
    }
    if(file.size>5*1024*1024){
      if(errEl){errEl.textContent='max 5MB'; errEl.style.display='block';}
      return;
    }
    // preview immediately
    const url=URL.createObjectURL(file);
    const previewEl=$('#logoPreview');
    if(previewEl){
      if(file.type==='image/svg+xml'){
        previewEl.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover">`;
      } else {
        // resize to 400x400 canvas
        const img=new Image();
        img.onload=async()=>{
          const canvas=document.createElement('canvas');
          canvas.width=400; canvas.height=400;
          const ctx=canvas.getContext('2d');
          // cover
          const scale=Math.max(400/img.width, 400/img.height);
          const w=img.width*scale, h=img.height*scale;
          const x=(400-w)/2, y=(400-h)/2;
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,400,400);
          ctx.drawImage(img,x,y,w,h);
          const blob=await new Promise(r=>canvas.toBlob(r,'image/webp',0.85));
          pendingLogoFile=new File([blob],'logo.webp',{type:'image/webp'});
          const pUrl=URL.createObjectURL(blob);
          previewEl.innerHTML=`<img src="${pUrl}" style="width:100%;height:100%;object-fit:cover">`;
          // upload via signed URL
          await uploadLogo(pendingLogoFile);
        };
        img.onerror=()=>{ previewEl.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover">`; pendingLogoFile=file; uploadLogo(file); };
        img.src=url;
      }
    }
  }
  async function uploadLogo(file){
    try{
      const r=await fetch('/api/logo-upload',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({filename: file.name, contentType: file.type})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'upload failed');
      // PUT to signed URL
      const put=await fetch(j.signedUrl,{method:'PUT', headers:{'Content-Type': file.type}, body: file});
      if(!put.ok) throw new Error('storage put failed');
      logoPath=j.path;
      logoUploadedAt=Date.now();
      const e=$('#logoError'); if(e){e.style.display='none';}
    }catch(e){
      const el=$('#logoError'); if(el){el.textContent=e.message; el.style.display='block';}
    }
  }

  // destination change → check existing
  const destInput=$('#destinationInput');
  if(destInput){
    let t=null;
    destInput.addEventListener('input',()=>{
      clearTimeout(t);
      t=setTimeout(checkExisting, 400);
    });
    destInput.addEventListener('blur', checkExisting);
  }
  async function checkExisting(){
    const raw=$('#destinationInput')?.value?.trim();
    if(!raw) return hideExisting();
    let dest;
    try{ dest=normalizeDestination(raw); }catch{ return hideExisting(); }
    try{
      const r=await fetch(`/api/check-existing?destination=${encodeURIComponent(dest)}`);
      const j=await r.json();
      if(j.exists){
        showExisting(j.entry);
      } else hideExisting();
    }catch{ hideExisting(); }
  }
  function showExisting(entry){
    const hint=$('#existingHint');
    if(hint){ hint.style.display='block'; hint.textContent=`Already on the list — this adds to your total. Current: $${(entry.total_bid_cents/100).toFixed(0)} · ${entry.description||''}`; }
    // make logo/desc optional
    const logoField=$('#logoField'); if(logoField) logoField.style.opacity='0.6';
    const desc=$('#descriptionInput'); if(desc) desc.placeholder='Leave blank to keep existing';
  }
  function hideExisting(){
    const h=$('#existingHint'); if(h) h.style.display='none';
    const lf=$('#logoField'); if(lf) lf.style.opacity='1';
    const d=$('#descriptionInput'); if(d) d.placeholder='What does it do? One or two sentences.';
  }

  // amount live split + position hint
  function updateSplit(){
    const bid=getBidAmount();
    const platform=Math.floor(bid*100*0.25);
    const donation=bid*100 - platform;
    const sb=$('#splitBid'), sd=$('#splitDonation'), sp=$('#splitPlatform');
    if(sb) sb.textContent='$'+bid;
    if(sd) sd.textContent='$'+(donation/100).toFixed(0);
    if(sp) sp.textContent='$'+(platform/100).toFixed(0);
    // position hint: need to compute rank this bid would take
    const hint=$('#positionHint');
    if(hint){
      const topCents=getTopBidCents();
      const topDollars=Math.round(topCents/100);
      // fetch board? use window.__allEntries if available
      const entries=window.__allEntries||[];
      const sorted=[...entries].sort((a,b)=>b.total_bid_cents-a.total_bid_cents);
      let rank=1;
      for(const e of sorted){ if(bid*100 <= e.total_bid_cents) rank++; else break; }
      // if existing, rank based on total would be + bid?
      const takes1 = bid >= topDollars+5 ? `takes #1` : `takes #${rank}`;
      const putsAt = rank<=8 ? `puts you at #${rank}` : `puts you at #${rank}`;
      // show both as spec: "$47 takes #1 · $12 puts you at #8 · minimum $5"
      // we have only current bid, so show what current bid does, and hint $5/$12
      const lowRank = (()=>{
        let r=1; for(const e of sorted){ if(500 <= e.total_bid_cents) r++; else break; } return r;
      })();
      hint.textContent=`$${bid} ${takes1} · minimum $5`;
      // if not #1, also show what #1 costs
      if(bid < topDollars+5 && topCents>0){
        hint.textContent+=` · $${topDollars+5} for #1`;
      }
    }
  }
  // hook stepper and input changes
  const dec=$('#decBtn'), inc=$('#incBtn'), bidVal=$('#bidValue');
  const obs=new MutationObserver(updateSplit);
  if(bidVal) obs.observe(bidVal,{childList:true, characterData:true, subtree:true});
  // also poll bid amount
  setInterval(updateSplit, 500);
  updateSplit();

  return {
    getLogoPath:()=>logoPath,
    getDescription:()=>$('#descriptionInput')?.value?.trim()||'',
    isExisting:()=>$('#existingHint')?.style.display==='block',
    resetLogo:()=>{ logoPath=null; pendingLogoFile=null; const p=$('#logoPreview'); if(p) p.innerHTML='drag & drop or click to pick'; }
  };
}
