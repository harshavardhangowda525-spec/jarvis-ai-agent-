/**
 * Injected into a preview shown in JARVIS's walkthrough frame. It talks only
 * to the frame's parent: it reports the sections that really exist on the
 * page plus live layout facts (horizontal overflow, script errors), and
 * scrolls to / highlights a section when JARVIS asks. Client-safe string.
 */
export const WALK_HELPER = `(function(){var errs=[];window.addEventListener('error',function(e){errs.push(String(e.message||'error').slice(0,160))});
function facts(){var d=document.documentElement;return{width:window.innerWidth,overflowX:d.scrollWidth>window.innerWidth+1,errors:errs.slice(0,5)}}
function list(){return [].slice.call(document.querySelectorAll('[data-aston-section]')).map(function(el){return{id:el.getAttribute('data-aston-section'),title:el.getAttribute('data-aston-title')||''}})}
function send(m){try{window.parent.postMessage(m,'*')}catch(e){}}
var st=document.createElement('style');st.textContent='.aston-hl{outline:3px solid #38bdf8!important;outline-offset:-3px;transition:outline-color .3s}';
window.addEventListener('message',function(e){if(e.source!==window.parent||!e.data||typeof e.data!=='object')return;var m=e.data;
if(m.type==='aston:goto'){var ok=false;if(typeof window.astonGoto==='function')ok=window.astonGoto(m.id);var el=document.querySelector('[data-aston-section="'+String(m.id).replace(/"/g,'')+'"]');
if(el&&!ok){el.scrollIntoView({behavior:'smooth',block:'start'})}document.querySelectorAll('.aston-hl').forEach(function(x){x.classList.remove('aston-hl')});if(el){el.classList.add('aston-hl');setTimeout(function(){el.classList.remove('aston-hl')},2600)}
setTimeout(function(){var f=facts();f.type='aston:at';f.id=m.id;f.found=!!el;send(f)},700)}
if(m.type==='aston:facts'){var g=facts();g.type='aston:facts';send(g)}});
window.addEventListener('DOMContentLoaded',function(){document.head.appendChild(st)});
window.addEventListener('load',function(){var f=facts();f.type='aston:ready';f.sections=list();send(f)});})();`;
