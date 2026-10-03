import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseResume} from '../extension/core.js';
const truth={
  backend:{fullName:'Alex Example',firstName:'Alex',lastName:'Example',email:'alex@example.invalid',phone:'+1 202 555 0104',city:'Austin',
    linkedin:'https://www.linkedin.com/in/alex-example',github:'https://github.com/example-alex',website:'https://example.invalid/alex',
    school:'Example State University',degree:'Bachelor of Science',graduation:'May 2028',currentEmployer:'Example Labs',currentTitle:'Software Engineering Intern'},
  ml:{fullName:'Alex Example',firstName:'Alex',lastName:'Example',email:'alex.ml@example.invalid',phone:'+1 202 555 0104',city:'Austin',
    school:'Example State University',degree:'Bachelor of Science',graduation:'May 2028'},
  unlabeled:{fullName:'Alex Example',email:'alex@example.invalid',phone:'+1 202-555-0104',github:'https://github.com/example-alex',
    linkedin:'https://www.linkedin.com/in/alex-example',school:'Example State University',degree:'Bachelor of Science in Computer Science',graduation:'May 2028'}
};
const rows=[];let proposed=0,correct=0,expected=0;
for(const [name,facts]of Object.entries(truth)){
  const text=readFileSync(new URL(`../fixtures/${name}.txt`,import.meta.url),'utf8');
  const hash=createHash('sha256').update(text).digest('hex');const r=parseResume(text,{name:`${name}.txt`,sha256:hash});
  expected+=Object.keys(facts).length;
  for(const candidate of r.facts){
    const ok=facts[candidate.key]===candidate.value;proposed++;if(ok)correct++;
    rows.push({fixture:name,key:candidate.key,value:candidate.value,expected:facts[candidate.key]??null,correct:ok,
      source:candidate.source,confidence:candidate.confidence,verified:false});
  }
}
const report={schema:'formproof.parser-evaluation.v1',timestamp:new Date().toISOString(),scope:'three original synthetic English text resumes; two labeled and one conventional section layout; no real resume benchmark',
  expected,proposed,correct,proposal_precision:correct/proposed,proposal_recall:correct/expected,
  all_proposals_require_user_verification:true,rows};
mkdirSync(new URL('../results/',import.meta.url),{recursive:true});writeFileSync(new URL('../results/parser-evaluation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({expected,proposed,correct,proposal_precision:report.proposal_precision,proposal_recall:report.proposal_recall}));
if(correct!==proposed||correct!==expected)process.exitCode=1;
