import {emptyProfile, parseResume, importResume, verifyCandidate, setUserFact, deleteFact,
  deleteResume, factState, rankResumes, buildPlan, approvePlan, EDITABLE, SENSITIVE} from './core.js';
import {seal, unseal} from './vault.js';
import {scanPage, applyPage} from './page.js';
const $ = id => document.getElementById(id);
let profile=null, password=null, plan=null, targetTab=null, saveChain=Promise.resolve(), lastSaveError=null;
let generation=0, transitioning=false;
const status=text=>{$('status').textContent=text;};
const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
function invalidate(){plan=null;targetTab=null;$('review').replaceChildren();$('destination').textContent='';
  $('sensitiveApproval').checked=false;$('apply').disabled=true;}
function current(ctx){return !transitioning && profile===ctx.profile && generation===ctx.generation;}
function assertCurrent(ctx){if(!current(ctx))throw new DOMException('Session changed','AbortError');}
function enqueueSave(snapshot,phrase){
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    await chrome.storage.local.set({vault:await seal(snapshot,phrase)});lastSaveError=null;
  }).catch(error=>{lastSaveError=error;throw error;});
  return saveChain;
}
function save(ctx){assertCurrent(ctx);return enqueueSave(structuredClone(ctx.profile),password);}
function guard(fn){return async(...args)=>{
  if(transitioning||!profile)return;
  const ctx={profile,generation};
  try{await fn(ctx,...args);}catch(e){if(current(ctx)&&e.name!=='AbortError')status(e.message||'Operation failed');}
};}
async function changed(ctx){assertCurrent(ctx);invalidate();await save(ctx);assertCurrent(ctx);render(ctx);}
function render(ctx){
  assertCurrent(ctx);
  const p=ctx.profile;
  $('profileCount').textContent=`${p.resumes.length} resume versions · revision ${p.revision}`;
  $('resumes').replaceChildren();$('resumeChoice').replaceChildren(node('option','Choose a version'));
  $('resumeChoice').firstChild.value='';
  for(const r of p.resumes){
    const row=node('div',r.name,'candidate'),remove=node('button','Remove','secondary');
    remove.addEventListener('click',guard(async c=>{deleteResume(c.profile,r.id);await changed(c);}));
    row.append(remove);$('resumes').append(row);
    const option=node('option',r.name);option.value=r.id;$('resumeChoice').append(option);
  }
  $('resumeChoice').value=p.selectedResume??'';$('facts').replaceChildren();
  for(const [key,fact]of Object.entries(p.facts)){
    const box=node('div','','candidate'),state=factState(p,key);
    box.append(node('strong',`${key}${SENSITIVE.has(key)?' · sensitive':''}`));
    box.append(node('div',state.candidate?'Verified choice':state.reason,state.candidate?'verified':'conflict'));
    for(const c of fact.candidates){
      const row=node('div');row.append(node('span',c.value));
      row.append(node('code',`\n${c.source.name}${c.source.line?` · line ${c.source.line}`:''}\n${c.source.excerpt}`));
      const verify=node('button',fact.selected===c.id&&c.verified?'Selected':'Verify & choose','secondary');
      verify.addEventListener('click',guard(async ctx=>{verifyCandidate(ctx.profile,key,c.id);await changed(ctx);}));
      row.append(verify);box.append(row);
    }
    const remove=node('button','Delete fact','danger');
    remove.addEventListener('click',guard(async c=>{deleteFact(c.profile,key);await changed(c);}));
    box.append(remove);$('facts').append(box);
  }
}
for(const key of EDITABLE){const option=node('option',`${key}${SENSITIVE.has(key)?' (sensitive, optional)':''}`);
  option.value=key;$('factKey').append(option);}
function clearPlaintext(){
  profile=null;password=null;invalidate();$('facts').replaceChildren();$('resumes').replaceChildren();$('ranking').replaceChildren();
  $('factValue').value='';$('job').value='';$('files').value='';$('resumeChoice').replaceChildren();$('profileCount').textContent='';
  $('workspace').hidden=true;$('workspace').inert=true;$('lockPanel').hidden=false;
}
function beginTransition(){
  if(transitioning)return false;
  transitioning=true;generation++;$('workspace').inert=true;$('unlock').disabled=true;return true;
}
function endTransition(){transitioning=false;$('unlock').disabled=false;$('workspace').inert=!profile;}
$('unlock').addEventListener('click',async()=>{
  if(!beginTransition())return;
  try{
    const phrase=$('password').value;
    if(phrase.length<12)throw new Error('Use a passphrase of at least 12 characters');
    if(chrome.storage.local.setAccessLevel)await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    const {vault}=await chrome.storage.local.get('vault'),loaded=vault?await unseal(vault,phrase):emptyProfile();
    if(!vault)await enqueueSave(structuredClone(loaded),phrase);
    profile=loaded;password=phrase;$('password').value='';$('lockPanel').hidden=true;$('workspace').hidden=false;
    endTransition();render({profile,generation});status('Unlocked locally.');
  }catch(e){clearPlaintext();endTransition();status(e.message||'Unlock failed');}
});
async function closeSession(erase){
  if(!profile||!beginTransition())return;
  // Fence callbacks synchronously, clear plaintext, and stop new writes before draining the stable queue.
  clearPlaintext();status(erase?'Deleting local profile…':'Locking profile…');
  try{
    await saveChain.catch(()=>{});
    if(erase){await chrome.storage.local.remove('vault');lastSaveError=null;
      status('Local profile deleted. Original files are unchanged.');}
    else status(lastSaveError?'Profile locked. The last edit was not saved; check it after unlocking.':'Profile locked.');
  }catch(e){status(`Profile locked. Deletion failed: ${e.message}; unlock and retry deletion.`);}
  finally{endTransition();}
}
$('lock').addEventListener('click',()=>closeSession(false));
$('erase').addEventListener('click',()=>closeSession(true));
$('files').addEventListener('change',guard(async ctx=>{
  const files=[...$('files').files];
  for(const file of files){
    if(file.size>1000000)throw new Error('Import files must be under 1 MB');
    const content=await file.text();assertCurrent(ctx);let documents;
    if(file.name.toLowerCase().endsWith('.json')){
      const bundle=JSON.parse(content);
      if(bundle.schema!=='formproof.resume-bundle.v1'||!Array.isArray(bundle.resumes)||bundle.resumes.length>25)
        throw new Error('Expected a local resume bundle');
      documents=bundle.resumes.map(r=>({name:r.name,text:r.text,original:r.sha256}));
    }else documents=[{name:file.name,text:content}];
    for(const item of documents){
      if(typeof item.text!=='string'||typeof item.name!=='string')throw new Error('Invalid resume bundle');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(item.text));assertCurrent(ctx);
      const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const resume=parseResume(item.text,{name:item.name.slice(0,200),sha256:hash});
      if(item.original)resume.originalFileSha256=item.original;
      importResume(ctx.profile,resume);
    }
  }
  $('files').value='';await changed(ctx);status('Imported. Verify each proposed fact before reuse.');
}));
$('saveFact').addEventListener('click',guard(async ctx=>{
  setUserFact(ctx.profile,$('factKey').value,$('factValue').value);$('factValue').value='';
  await changed(ctx);status('Saved your explicit answer locally.');
}));
$('rank').addEventListener('click',guard(async ctx=>{
  const ranking=rankResumes(ctx.profile,$('job').value);$('ranking').replaceChildren();
  for(const row of ranking.rows)$('ranking').append(node('p',`${row.name} · score ${row.score.toFixed(2)} · matched: ${row.matched.join(', ')||'none'}`));
  $('ranking').append(node('p',ranking.suggestion?'Suggested version highlighted. Confirm your choice below.':'No clear winner. Choose a version manually.'));
  if(ranking.suggestion)$('resumeChoice').value=ranking.suggestion;
}));
async function chooseResume(ctx){
  ctx.profile.selectedResume=$('resumeChoice').value||null;ctx.profile.revision++;
  await changed(ctx);status('Version selected. Attach the original resume file manually.');
}
$('resumeChoice').addEventListener('change',guard(chooseResume));
$('confirmResume').addEventListener('click',guard(async ctx=>{
  if(!$('resumeChoice').value)throw new Error('Choose a version first');await chooseResume(ctx);
}));
$('scan').addEventListener('click',guard(async ctx=>{
  invalidate();const [tab]=await chrome.tabs.query({active:true,currentWindow:true});assertCurrent(ctx);
  if(!tab?.id||!/^https?:/.test(tab.url||''))throw new Error('Open an HTTP(S) application page first');
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:scanPage});assertCurrent(ctx);
  const snapshot=results[0]?.result;if(!snapshot)throw new Error('Could not inspect this page');
  targetTab=tab.id;plan=buildPlan(ctx.profile,snapshot);
  const actions=[...new Set(snapshot.fields.map(f=>f.action).filter(Boolean))];
  $('destination').textContent=`Page: ${plan.url}\nForm destinations:\n${actions.length?actions.join('\n'):'No forms'}`;
  for(const row of plan.rows){
    const box=node('div','','review-row');
    if(row.status==='abstain')box.append(node('div',`${row.label||'(unlabeled)'} · skipped: ${row.reason}`,'abstain'));
    else{
      const label=node('label','','check'),check=document.createElement('input');
      check.type='checkbox';check.dataset.field=row.id;check.checked=!row.sensitive;
      label.append(check,node('span',`${row.label} → ${row.displayValue}${row.sensitive?' · sensitive':''}`));box.append(label);
      box.append(node('code',`${row.source.name}${row.source.line?` · line ${row.source.line}`:''}\nDestination: ${row.action}`));
    }
    $('review').append(box);
  }
  $('apply').disabled=!plan.rows.some(r=>r.status!=='abstain');status('Review every proposed answer, then fill once.');
}));
$('apply').addEventListener('click',guard(async ctx=>{
  if(!plan)throw new Error('Inspect the page first');
  const ids=[...$('review').querySelectorAll('input:checked')].map(e=>e.dataset.field);
  if(!ids.length)throw new Error('Select at least one proposed fill');
  const approval=approvePlan(plan,ids,$('sensitiveApproval').checked,ctx.profile.revision);
  const results=await chrome.scripting.executeScript({target:{tabId:targetTab},func:applyPage,args:[approval]});assertCurrent(ctx);
  const result=results[0]?.result;invalidate();
  status(result?`${result.applied.length} fields filled. ${result.errors.join(' ')||'Review the page. Nothing was submitted.'}`:'No result; inspect the page again.');
}));
