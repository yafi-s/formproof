// Descriptor-level evaluation. Browser DOM evaluation is independently recorded by browser_check.py.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {emptyProfile,setUserFact,buildPlan} from '../extension/core.js';
const cases=JSON.parse(readFileSync(new URL('../fixtures/cases.json',import.meta.url)));
export const VALUES={firstName:'Alex',lastName:'Example',fullName:'Alex Example',email:'alex@example.invalid',
  phone:'+1 202 555 0104',city:'Austin',linkedin:'https://www.linkedin.com/in/alex-example',github:'https://github.com/example-alex',
  website:'https://example.invalid/alex',school:'Example State University',degree:'Bachelor of Science',graduation:'May 2028',
  currentEmployer:'Example Labs',currentTitle:'Software Engineering Intern',gender:'Prefer not to say',citizenship:'Synthetic country',
  ethnicity:'Prefer not to say',sponsorship:'No',workAuthorization:'Yes',veteranStatus:'Prefer not to say'};
const p=emptyProfile();for(const [key,value]of Object.entries(VALUES))setUserFact(p,key,value);
const rows=[];const times=[];let correct=0,proposed=0,supported=0,abstained=0;
for(const fixture of cases){
  const fields=fixture.fields.map((f,i)=>({id:`f${i}`,label:f.label,signature:`s${i}`,autocomplete:f.autocomplete??'',
    kind:f.kind==='radio'?'radio':f.kind==='select'?'select':'text',currentValue:f.value??'',
    options:(f.options??[]).map(([value,label])=>({value,label,disabled:false})),
    blocked:f.disabled||f.readonly?'disabled or read-only':f.hidden?'hidden field':['password','file','checkbox','date'].includes(f.type)?'unsupported control':null}));
  const start=performance.now();const plan=buildPlan(p,{nonce:'n',url:'http://127.0.0.1/mock',destination:'d',fields});times.push(performance.now()-start);
  plan.rows.forEach((row,i)=>{
    const truth=fixture.fields[i];const expected=truth.key?(truth.expected??VALUES[truth.key]):null;
    const accepted=row.status!=='abstain';const good=accepted&&expected!==null&&row.value===expected;
    if(expected!==null)supported++;if(accepted)proposed++;if(good)correct++;if(!accepted)abstained++;
    rows.push({fixture:fixture.name,label:truth.label,expected,proposed:accepted?row.value:null,correct:good,reason:row.reason??null});
  });
}
const report={schema:'formproof.evaluation.v1',timestamp:new Date().toISOString(),environment:{node:process.version,platform:process.platform},
  workload:'64 synthetic native-control fields on 6 controlled ATS fixture schemas; no real applications or human participants',
  total:rows.length,supported,proposed,correct,precision:correct/proposed,recall:correct/supported,abstention_rate:abstained/rows.length,
  required_corrections:proposed-correct,planning_ms:times,
  time_savings:{measured_human_seconds:null,reason:'No human study was conducted; no time-savings claim is supported'},rows};
mkdirSync(new URL('../results/',import.meta.url),{recursive:true});
writeFileSync(new URL('../results/descriptor-evaluation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({total:report.total,supported,proposed,correct,precision:report.precision,recall:report.recall,abstention_rate:report.abstention_rate,required_corrections:report.required_corrections}));
if(correct!==proposed||correct!==supported)process.exitCode=1;
