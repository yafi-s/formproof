import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as c from '../extension/core.js';
import {seal,unseal} from '../extension/vault.js';
const resume = name => {const text=readFileSync(new URL(`../fixtures/${name}.txt`,import.meta.url),'utf8');
  return c.parseResume(text,{name:`${name}.txt`,sha256:createHash('sha256').update(text).digest('hex')});};
const field = (label,more={}) => ({id:'f',label,autocomplete:'',kind:'text',currentValue:'',signature:'s',options:[],...more});
const snap = fields => ({nonce:'n',url:'https://ats.example.invalid/job/42',destination:'d',fields});
const user = (key,value) => {const p=c.emptyProfile();c.setUserFact(p,key,value);return p;};

test('resume proposals preserve hash, exact source line and unverified state',()=>{
  const p=c.emptyProfile(),r=resume('backend');c.importResume(p,r);
  assert.equal(c.factState(p,'email').reason,'needs user verification');
  const e=p.facts.email.candidates[0];assert.equal(e.source.line,4);assert.equal(e.source.excerpt,'Email: alex@example.invalid');
  assert.equal(e.source.sha256,r.sha256);assert.equal(e.verified,false);
});
test('importing identical content is idempotent',()=>{const p=c.emptyProfile(),r=resume('backend');c.importResume(p,r);
  const rev=p.revision;assert.equal(c.importResume(p,r),false);assert.equal(p.revision,rev);});
test('conflicting imports invalidate previously selected facts',()=>{
  const p=c.emptyProfile();c.importResume(p,resume('backend'));c.verifyCandidate(p,'email',p.facts.email.candidates[0].id);
  c.importResume(p,resume('ml'));assert.equal(c.factState(p,'email').reason,'conflicting resume versions');
  assert.equal(c.buildPlan(p,snap([field('Email')])).rows[0].status,'abstain');
});
test('explicit conflict resolution records a verified source choice',()=>{
  const p=c.emptyProfile();c.importResume(p,resume('backend'));c.importResume(p,resume('ml'));
  c.verifyCandidate(p,'email',p.facts.email.candidates[1].id);assert.equal(c.factState(p,'email').candidate.value,'alex.ml@example.invalid');
});
test('same normalized value across versions does not revoke verification',()=>{
  const p=c.emptyProfile();c.importResume(p,resume('backend'));c.verifyCandidate(p,'city',p.facts.city.candidates[0].id);
  c.importResume(p,resume('ml'));assert.equal(c.factState(p,'city').candidate.value,'Austin');
});
test('resume parser never derives demographic or citizenship facts',()=>{
  const r=c.parseResume('Name: Test Person\nGender: Male\nCitizenship: US\nEthnicity: X\nSponsorship: No', {name:'synthetic',sha256:'hash'});
  assert.deepEqual(r.facts.map(f=>f.key),['fullName']);
});
test('unlabeled name is a low-confidence unverified proposal',()=>{
  const r=c.parseResume('Example Person\nEngineer',{name:'r',sha256:'h'});assert.equal(r.facts[0].confidence,0.7);
});
test('standard unlabeled contact and explicit education sections produce source-backed proposals',()=>{
  const r=resume('unlabeled');const facts=Object.fromEntries(r.facts.map(f=>[f.key,f.value]));
  assert.equal(facts.phone,'+1 202-555-0104');assert.equal(facts.school,'Example State University');
  assert.equal(facts.degree,'Bachelor of Science in Computer Science');assert.equal(facts.graduation,'May 2028');
  assert.equal(r.facts.find(f=>f.key==='school').source.line,5);
});
test('employment dates cannot become graduation dates and prototype-like labels are inert',()=>{
  const r=c.parseResume('EXPERIENCE\nExample University\nExpected May 2028\n__proto__: bad\nconstructor: bad',{name:'r',sha256:'h'});
  assert.equal(r.facts.some(f=>['school','graduation'].includes(f.key)),false);
  assert.equal(r.facts.some(f=>typeof f.key!=='string'),false);
  assert.equal(r.facts.some(f=>f.key==='fullName'),false);
});
test('unsupported user fact keys and empty values are rejected',()=>{
  assert.throws(()=>c.setUserFact(c.emptyProfile(),'inventedExperience','yes'));
  assert.throws(()=>c.setUserFact(c.emptyProfile(),'email',' '));
});
test('deleting a resume removes sourced facts and selection',()=>{
  const p=c.emptyProfile(),r=resume('backend');c.importResume(p,r);p.selectedResume=r.id;c.deleteResume(p,r.id);
  assert.equal(p.resumes.length,0);assert.equal(p.selectedResume,null);assert.deepEqual(p.facts,{});
});
test('deleting sensitive answer removes all retained candidates',()=>{const p=user('gender','Prefer not to say');c.setUserFact(p,'gender','Other');
  c.deleteFact(p,'gender');assert.equal(p.facts.gender,undefined);});
test('job matching is explainable and ties abstain',()=>{
  const p=c.emptyProfile();c.importResume(p,resume('backend'));c.importResume(p,resume('ml'));
  const a=c.rankResumes(p,'SQL databases transactions recovery');assert.equal(a.suggestion,p.resumes[0].id);assert.ok(a.rows[0].matched.includes('sql'));
  assert.equal(c.rankResumes(p,'Python').suggestion,null);assert.equal(c.rankResumes(p,'unknownword').suggestion,null);
});
test('label/autocomplete contradiction abstains',()=>{assert.equal(c.classifyField(field('Last name',{autocomplete:'given-name'})).reason,'label/autocomplete conflict');});
test('unknown sensitive wording cannot use ordinary autocomplete fallback',()=>{
  assert.equal(c.classifyField(field('Citizenship and full name',{autocomplete:'name'})).reason,'unrecognized sensitive wording');
});
test('narrative questions and inferred years of experience abstain',()=>{
  for(const label of ['Why should we hire you?','Years of experience','Expected salary','Tell us about yourself'])assert.ok(c.classifyField(field(label)).reason);
});
test('unlabeled standard autocomplete can propose verified contact facts',()=>{
  const p=user('email','test@example.invalid');assert.equal(c.buildPlan(p,snap([field('',{autocomplete:'email'})])).rows[0].value,'test@example.invalid');
});
test('select mapping requires a unique exact option',()=>{
  const p=user('degree','Bachelor of Science');const f=field('Degree',{kind:'select',options:[{value:'bs',label:'Bachelor of Science',disabled:false}]});
  assert.equal(c.buildPlan(p,snap([f])).rows[0].value,'bs');
  f.options.push({value:'bsc',label:'Bachelor of Science',disabled:false});assert.equal(c.buildPlan(p,snap([f])).rows[0].reason,'ambiguous options');
});
test('missing select option abstains rather than taking closest label',()=>{
  const p=user('citizenship','US');assert.equal(c.buildPlan(p,snap([field('Citizenship',{kind:'select',options:[{value:'x',label:'Other',disabled:false}]})])).rows[0].reason,'no exact option match');
});
test('existing and unsupported fields never receive a proposal',()=>{
  const p=user('email','test@example.invalid');for(const f of [field('Email',{currentValue:'user@existing.invalid'}),field('Email',{blocked:'hidden field'})])
    assert.equal(c.buildPlan(p,snap([f])).rows[0].status,'abstain');
});
test('sensitive approval is explicit and destination scoped',()=>{
  const p=user('gender','Prefer not to say'),plan=c.buildPlan(p,snap([field('Gender')]));
  assert.equal(plan.rows[0].status,'sensitive-review');assert.throws(()=>c.approvePlan(plan,['f'],false,p.revision),/approval required/);
  const approval=c.approvePlan(plan,['f'],true,p.revision);assert.equal(approval.url,plan.url);assert.equal(approval.nonce,'n');
});
test('profile changes invalidate previously reviewed plans',()=>{const p=user('email','a@example.invalid');const plan=c.buildPlan(p,snap([field('Email')]));
  c.setUserFact(p,'email','b@example.invalid');assert.throws(()=>c.approvePlan(plan,['f'],false,p.revision),/Profile changed/);});
test('abstention cannot be manually approved as a generated answer',()=>{
  const p=c.emptyProfile(),plan=c.buildPlan(p,snap([field('Years of experience')]));assert.throws(()=>c.approvePlan(plan,['f'],false,0),/abstained/);
});
test('unknown approval field ids fail closed',()=>{
  const p=user('email','a@example.invalid'),plan=c.buildPlan(p,snap([field('Email')]));
  assert.throws(()=>c.approvePlan(plan,['not-in-plan'],false,p.revision),/Unknown reviewed field/);
});
test('vault encrypts every fact and refuses wrong passphrases or tampering',async()=>{
  const p=user('citizenship','Synthetic answer');const envelope=await seal(p,'synthetic passphrase 2026');
  assert.equal(JSON.stringify(envelope).includes('Synthetic answer'),false);
  assert.deepEqual(await unseal(envelope,'synthetic passphrase 2026'),p);
  await assert.rejects(()=>unseal(envelope,'wrong passphrase 2026'));
  const modified={...envelope,data:(envelope.data[0]==='A'?'B':'A')+envelope.data.slice(1)};
  await assert.rejects(()=>unseal(modified,'synthetic passphrase 2026'));
});
test('vault uses unique salts/IVs and validates format and passphrase length',async()=>{
  const p=c.emptyProfile();const a=await seal(p,'synthetic passphrase'),b=await seal(p,'synthetic passphrase');
  assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);await assert.rejects(()=>seal(p,'short'));
  await assert.rejects(()=>unseal({...a,iterations:1},'synthetic passphrase'));
});
