import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
import {validateDocxZip} from '../extension/zip_guard.js';
import {parseUploadedFile} from '../extension/upload.js';
import {parseResume,optionValue,buildPlan,emptyProfile,setUserFact,approvePlan} from '../extension/core.js';
import {seal,checkProfileSize} from '../extension/vault.js';

const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const archive=more=>zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8('<document/>'),...more});
test('DOCX validates actual bytes and rejects unsafe entry names',()=>{
  assert.equal(validateDocxZip(buffer(archive({}))).entries,2);
  for(const name of ['../escape','/absolute','a\\b','__proto__/x','word/../escape','a:b'])
    assert.throws(()=>validateDocxZip(buffer(archive({[name]:strToU8('unsafe')}))),/Unsafe/);
});
test('DOCX rejects forged inflated lengths and corrupt CRCs before extraction',()=>{
  const bytes=archive({'word/large.xml':new Uint8Array(1024*1024).fill(65)});
  const forged=bytes.slice(),view=new DataView(forged.buffer);
  for(let i=0;i<forged.length-46;i++)if(view.getUint32(i,true)===0x02014b50&&view.getUint32(i+24,true)>1000){
    const local=view.getUint32(i+42,true);view.setUint32(i+24,10,true);view.setUint32(local+22,10,true);break;}
  assert.throws(()=>validateDocxZip(buffer(forged)),/limit|Corrupt/);
  const bad=archive({}),v=new DataView(bad.buffer);
  for(let i=0;i<bad.length-46;i++)if(v.getUint32(i,true)===0x02014b50){v.setUint32(i+16,0,true);break;}
  assert.throws(()=>validateDocxZip(buffer(bad)),/Corrupt/);
});
test('DOCX refuses declared size bombs, truncation and missing document content',()=>{
  assert.throws(()=>validateDocxZip(buffer(archive({'large.xml':new Uint8Array(4*1024*1024+1)}))),/limits/);
  assert.throws(()=>validateDocxZip(buffer(archive({}).slice(0,-5))));
  assert.throws(()=>validateDocxZip(buffer(zipSync({'word/a.xml':strToU8('x')}))),/missing/);
});
test('text upload keeps original digest and source; every proposed fact stays unverified',async()=>{
  const text='Name: Synthetic Person\nEmail: person@example.invalid\nGender: Female';
  const [resume]=await parseUploadedFile(new File([text],'resume.TXT'));
  assert.equal(resume.originalFileSha256,resume.sha256);assert.equal(resume.parser,'UTF-8 text');
  assert.deepEqual(resume.facts.map(f=>f.key),['fullName','email']);
  assert.ok(resume.facts.every(f=>!f.verified&&f.source.excerpt));
});
test('upload rejects invalid UTF-8, empty, oversized, unsupported and cancelled files',async()=>{
  for(const file of [new File([new Uint8Array([255])],'r.txt'),new File([],'r.txt'),
    new File([new Uint8Array(5*1024*1024+1)],'r.txt'),new File(['x'],'r.doc'),
    new File(['not a PDF'],'r.pdf'),new File(['not a zip'],'r.docx'),new File(['{}'],'r.json')])
    await assert.rejects(()=>parseUploadedFile(file));
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>parseUploadedFile(new File(['x'],'r.txt'),{signal:controller.signal}),{name:'AbortError'});
});
test('PDF provenance maps a source line to its actual extracted page',()=>{
  const r=parseResume('Name: Synthetic Person\nEmail: person@example.invalid',{name:'synthetic.pdf',sha256:'h',linePages:[1,2]});
  assert.equal(r.facts.find(f=>f.key==='email').source.page,2);
});
test('month conversion never guesses a date and validates leap years and bounds',()=>{
  assert.equal(optionValue({kind:'month'},'May 2028').value,'2028-05');
  assert.match(optionValue({kind:'date'},'May 2028').reason,/no day/);
  assert.equal(optionValue({kind:'date'},'2024-02-29').value,'2024-02-29');
  for(const value of ['2023-02-29','1900-02-29','2024-04-31','0000-01-01','2024-13-01'])
    assert.equal(optionValue({kind:'date'},value).reason,'invalid calendar date');
  assert.equal(optionValue({kind:'month',min:'2029-01'},'May 2028').reason,'date is outside form bounds');
  assert.match(optionValue({kind:'date',step:'7'},'2024-02-29').reason,/manual/);
});
test('exact birth date remains a sensitive explicit-answer field',()=>{
  const p=emptyProfile();setUserFact(p,'birthDate','2000-02-29');
  const plan=buildPlan(p,{url:'https://synthetic.invalid',destination:'d',nonce:'n',fields:[
    {id:'b',label:'Date of birth',kind:'date',currentValue:'',signature:'s',autocomplete:''}]});
  assert.equal(plan.rows[0].status,'sensitive-review');
  assert.throws(()=>approvePlan(plan,['b'],false,p.revision),/approval required/);
});
test('serialized UTF-8 vault admission bounds ciphertext before encryption',async()=>{
  const p=emptyProfile();p.resumes=[{text:'é'.repeat(2100000)}];
  assert.throws(()=>checkProfileSize(p),/4 MB/);
  await assert.rejects(()=>seal(p,'synthetic passphrase'),/Nothing was changed/);
});
