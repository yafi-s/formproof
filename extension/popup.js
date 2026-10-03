import {emptyProfile, importResume, verifyCandidate, setUserFact, deleteFact,
  deleteResume, factState, rankResumes, buildPlan, approvePlan, EDITABLE, SENSITIVE} from './core.js';
import {seal, unseal, checkProfileSize} from './vault.js';
import {scanPage, applyPage} from './page.js';
import {parseUploadedFile} from './upload.js';
const $ = id => document.getElementById(id);
let profile=null, password=null, plan=null, targetTab=null, saveChain=Promise.resolve(), lastSaveError=null;
let generation=0, transitioning=false;
let mutationChain=Promise.resolve();
let importController=null;
let ownsWorkspace=!chrome.runtime?.id;
const factTitle=key=>({linkedin:'LinkedIn',github:'GitHub',ssn:'Social Security number'}[key]??
  (key[0].toUpperCase()+key.slice(1).replace(/[A-Z]/g,m=>' '+m.toLowerCase())));
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
function guard(fn){return async(...args)=>{
  if(transitioning||!profile)return;
  const ctx={profile,generation};
  try{await fn(ctx,...args);}catch(e){if(current(ctx)&&e.name!=='AbortError')status(e.message||'Operation failed');}
};}
function mutate(ctx,change){
  // Persist a private draft before exposing it. Serializing mutations preserves edits
  // made while parsing/saving and keeps the displayed and durable profiles consistent.
  const task=mutationChain.catch(()=>{}).then(async()=>{
    assertCurrent(ctx);const draft=structuredClone(ctx.profile);change(draft);checkProfileSize(draft);
    invalidate();await enqueueSave(draft,password);assertCurrent(ctx);
    Object.assign(ctx.profile,draft);render(ctx);
  });
  mutationChain=task;return task;
}
function render(ctx){
  assertCurrent(ctx);
  const p=ctx.profile;
  $('profileCount').textContent=`${p.resumes.length} resume versions · revision ${p.revision}`;
  $('resumes').replaceChildren();$('resumeChoice').replaceChildren(node('option','Choose a version'));
  $('resumeChoice').firstChild.value='';
  for(const r of p.resumes){
    const row=node('div',r.name,'candidate'),remove=node('button','Remove','secondary');
    remove.addEventListener('click',guard(async c=>{await mutate(c,p=>deleteResume(p,r.id));}));
    row.append(remove);$('resumes').append(row);
    row.append(node('div',`${r.parser??'UTF-8 text'}${r.pages?` · ${r.pages} pages`:''}`,'muted'));
    for(const warning of r.warnings??[])row.append(node('p',warning,'muted'));
    const extracted=document.createElement('details');extracted.append(node('summary','Review extracted text'));
    extracted.append(node('pre',r.text));row.append(extracted);
    const option=node('option',r.name);option.value=r.id;$('resumeChoice').append(option);
  }
  $('resumeChoice').value=p.selectedResume??'';$('facts').replaceChildren();
  for(const [key,fact]of Object.entries(p.facts)){
    const box=node('div','','candidate'),state=factState(p,key);
    const heading=node('strong',`${factTitle(key)}${SENSITIVE.has(key)?' · sensitive':''}`);heading.dataset.key=key;box.append(heading);
    box.append(node('div',state.candidate?'Verified choice':state.reason,state.candidate?'verified':'conflict'));
    for(const c of fact.candidates){
      const row=node('div');row.append(node('span',c.value));
      row.append(node('code',`\n${c.source.name}${c.source.page?` · page ${c.source.page}`:''}${c.source.line?` · line ${c.source.line}`:''}\n${c.source.excerpt}`));
      const verify=node('button',fact.selected===c.id&&c.verified?'Selected':'Verify & choose','secondary');
      verify.addEventListener('click',guard(async ctx=>{await mutate(ctx,p=>verifyCandidate(p,key,c.id));status(`${factTitle(key)} verified for reuse.`);}));
      row.append(verify);box.append(row);
    }
    const remove=node('button','Delete fact','danger');
    remove.addEventListener('click',guard(async c=>{await mutate(c,p=>deleteFact(p,key));}));
    const edit=node('button','Edit answer','secondary');
    edit.addEventListener('click',guard(async()=>{
      $('manualFact').open=true;$('factKey').value=key;$('factValue').value=state.candidate?.value??fact.candidates[0]?.value??'';
      $('factValue').focus();$('manualFact').scrollIntoView({block:'center'});
    }));
    box.append(edit,remove);$('facts').append(box);
  }
  const name=factState(p,'fullName').candidate??p.facts.fullName?.candidates[0];
  $('nameParts').hidden=!name||(factState(p,'firstName').candidate&&factState(p,'lastName').candidate);
  $('originalName').textContent=name?`Name in your source: ${name.value}. Enter the name parts exactly as you want the ATS to receive them.`:'';
}
for(const key of EDITABLE){const option=node('option',`${factTitle(key)}${SENSITIVE.has(key)?' (sensitive, optional)':''}`);
  option.value=key;$('factKey').append(option);}
function clearPlaintext(){
  importController?.abort();importController=null;$('importProgress').textContent='';$('files').disabled=false;
  profile=null;password=null;invalidate();$('facts').replaceChildren();$('resumes').replaceChildren();$('ranking').replaceChildren();
  $('factValue').value='';$('job').value='';$('files').value='';$('resumeChoice').replaceChildren();$('profileCount').textContent='';
  $('confirmedFirstName').value='';$('confirmedLastName').value='';$('originalName').textContent='';
  $('workspace').hidden=true;$('workspace').inert=true;$('lockPanel').hidden=false;
}
function beginTransition(){
  if(transitioning)return false;
  transitioning=true;generation++;$('workspace').inert=true;$('unlock').disabled=true;return true;
}
function endTransition(){transitioning=false;$('unlock').disabled=!ownsWorkspace;$('workspace').inert=!profile;}
$('unlock').addEventListener('click',async()=>{
  if(!ownsWorkspace)return;
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
  if(!files.length)return;
  if(files.length>10)throw new Error('Import at most 10 files at a time');
  importController?.abort();const controller=new AbortController();importController=controller;
  $('files').disabled=true;
  try{
    // Stage every extraction before changing the profile: one malformed file cannot cause a partial import.
    const staged=[];
    for(const file of files){
      assertCurrent(ctx);$('importProgress').textContent=`Parsing ${file.name} locally…`;
      staged.push(...await parseUploadedFile(file,{signal:controller.signal}));assertCurrent(ctx);
    }
    await mutate(ctx,p=>{
      for(const resume of staged)importResume(p,resume);
      if(p.resumes.length>25)throw new Error('Keep at most 25 resume versions in this profile');
    });
    $('files').value='';status('Imported. Verify each proposed fact before reuse.');
    $('facts').scrollIntoView({block:'start'});
  }finally{
    if(importController===controller){importController=null;$('importProgress').textContent='';$('files').disabled=false;}
  }
}));
$('confirmNameParts').addEventListener('click',guard(async ctx=>{
  const firstInput=$('confirmedFirstName').value,lastInput=$('confirmedLastName').value;
  const first=firstInput.trim(),last=lastInput.trim();
  if(!first||!last)throw new Error('Enter both name parts, or leave this step manual.');
  await mutate(ctx,p=>{setUserFact(p,'firstName',first);setUserFact(p,'lastName',last);});
  if($('confirmedFirstName').value===firstInput)$('confirmedFirstName').value='';
  if($('confirmedLastName').value===lastInput)$('confirmedLastName').value='';
  status('Saved the name parts you explicitly confirmed.');
}));
$('saveFact').addEventListener('click',guard(async ctx=>{
  const key=$('factKey').value,value=$('factValue').value;
  await mutate(ctx,p=>setUserFact(p,key,value));
  if($('factKey').value===key&&$('factValue').value===value)$('factValue').value='';
  status('Saved your explicit answer locally.');
}));
$('rank').addEventListener('click',guard(async ctx=>{
  const ranking=rankResumes(ctx.profile,$('job').value);$('ranking').replaceChildren();
  for(const row of ranking.rows)$('ranking').append(node('p',`${row.name} · score ${row.score.toFixed(2)} · matched: ${row.matched.join(', ')||'none'}`));
  $('ranking').append(node('p',ranking.suggestion?'Suggested version highlighted. Confirm your choice below.':'No clear winner. Choose a version manually.'));
  if(ranking.suggestion)$('resumeChoice').value=ranking.suggestion;
}));
async function chooseResume(ctx){
  const selected=$('resumeChoice').value||null;
  await mutate(ctx,p=>{p.selectedResume=selected;p.revision++;});status('Version selected. Attach the original resume file manually.');
}
$('resumeChoice').addEventListener('change',guard(chooseResume));
$('confirmResume').addEventListener('click',guard(async ctx=>{
  if(!$('resumeChoice').value)throw new Error('Choose a version first');await chooseResume(ctx);
}));
$('scan').addEventListener('click',guard(async ctx=>{
  invalidate();const tab=await applicationTab();assertCurrent(ctx);
  if(!tab?.url)throw new Error('Page access expired. Click the FormProof toolbar icon on the application tab, then inspect again.');
  if(!tab?.id||!/^https?:/.test(tab.url))throw new Error('Open an HTTP(S) application page first');
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:scanPage});assertCurrent(ctx);
  const snapshot=results[0]?.result;if(!snapshot)throw new Error('Could not inspect this page');
  targetTab=tab.id;plan=buildPlan(ctx.profile,snapshot);
  const actions=[...new Set(snapshot.fields.map(f=>f.action).filter(Boolean))];
  $('destination').textContent=`Page: ${plan.url}\nForm destinations:\n${actions.length?actions.join('\n'):'No forms'}`;
  let hiddenFields=0;
  for(const row of plan.rows){
    if(row.status==='abstain'&&row.reason==='hidden field'){hiddenFields++;continue;}
    const box=node('div','','review-row');
    if(row.status==='abstain')box.append(node('div',`${row.label||'(unlabeled)'} · skipped: ${row.reason}`,'abstain'));
    else{
      const label=node('label','','check'),check=document.createElement('input');
      check.type='checkbox';check.dataset.field=row.id;check.checked=!row.sensitive;
      label.append(check,node('span',`${row.label} → ${row.displayValue}${row.sensitive?' · sensitive':''}`));box.append(label);
      box.append(node('code',`${row.source.name}${row.source.page?` · page ${row.source.page}`:''}${row.source.line?` · line ${row.source.line}`:''}\nDestination: ${row.action}`));
    }
    $('review').append(box);
  }
  if(hiddenFields)$('review').append(node('p',`${hiddenFields} hidden fields left untouched. Inspect again after moving to another step.`,'muted'));
  $('apply').disabled=!plan.rows.some(r=>r.status!=='abstain');status('Review every proposed answer, then fill once.');
}));
$('sensitiveApproval').addEventListener('change',()=>{
  if(plan)status($('sensitiveApproval').checked?'Sensitive answers approved for this reviewed destination. Fill only the selected fields.':'Sensitive answers require separate approval before filling.');
});
$('apply').addEventListener('click',guard(async ctx=>{
  if(!plan)throw new Error('Inspect the page first');
  const application=await applicationTab();assertCurrent(ctx);
  if(application?.id!==targetTab){invalidate();throw new Error('Application tab changed; inspect and review again.');}
  const ids=[...$('review').querySelectorAll('input:checked')].map(e=>e.dataset.field);
  if(!ids.length)throw new Error('Select at least one proposed fill');
  const approval=approvePlan(plan,ids,$('sensitiveApproval').checked,ctx.profile.revision);
  const results=await chrome.scripting.executeScript({target:{tabId:targetTab},func:applyPage,args:[approval]});assertCurrent(ctx);
  const result=results[0]?.result;invalidate();
  status(result?`${result.applied.length} fields filled. ${result.errors.join(' ')||'Review the page. Nothing was submitted.'}`:'No result; inspect the page again.');
}));
async function applicationTab(){
  if(chrome.runtime?.id){
    const {targetTabId}=await chrome.storage.session.get('targetTabId');
    if(!Number.isSafeInteger(targetTabId))throw new Error('Open an application page and click the FormProof toolbar icon.');
    try{return await chrome.tabs.get(targetTabId);}catch{throw new Error('The application tab was closed. Invoke FormProof on a new page.');}
  }
  return (await chrome.tabs.query({active:true,currentWindow:true}))[0];
}
if(chrome.runtime?.id){
  $('unlock').disabled=true;
  if(!navigator.locks)status('This browser lacks the local workspace lock. Use a current Chrome or Edge version.');
  else navigator.locks.request('formproof-review-workspace',{ifAvailable:true},async lock=>{
    if(!lock){status('FormProof is already open in another window. Return to that window to avoid conflicting edits.');return;}
    ownsWorkspace=true;$('unlock').disabled=false;
    await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));
  }).catch(()=>status('Could not secure the local workspace lock. Close this window and try again.'));
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id===chrome.runtime.id&&message?.type==='formproof-target-changed'){
      invalidate();status('Application tab changed. Inspect and review its fields before filling.');
    }
  });
}
