import {parseResume} from './core.js';
const MAX_FILE=5*1024*1024;
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('Import cancelled','AbortError');};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function extract(kind,buffer,signal){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./parser-worker.js',import.meta.url),{type:'module'});
    const finish=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value);};
    const cancel=()=>finish(new DOMException('Import cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Parsing exceeded 15 seconds. Export a simpler text-based resume.')),15000);
    signal?.addEventListener('abort',cancel,{once:true});
    worker.onerror=()=>finish(new Error('The local parser failed. Try a text export or a simpler document.'));
    worker.onmessage=({data})=>data.ok?finish(null,data.result):finish(new Error(data.error));
    worker.postMessage({kind,buffer},[buffer]);
  });
}
export async function parseUploadedFile(file,{signal}={}){
  checkAbort(signal);
  if(!file.size||file.size>MAX_FILE)throw new Error('Resume files must be nonempty and at most 5 MB');
  const kind=file.name.toLowerCase().split('.').at(-1);
  if(!['pdf','docx','txt','md','json'].includes(kind))throw new Error('Use PDF, DOCX, UTF-8 TXT/Markdown, or a local importer JSON bundle. Legacy DOC and images are unsupported.');
  const buffer=await file.arrayBuffer();checkAbort(signal);
  const originalFileSha256=await digest(buffer);checkAbort(signal);
  let documents;
  if(kind==='pdf'||kind==='docx'){
    const header=new Uint8Array(buffer);
    if(kind==='pdf'&&new TextDecoder().decode(header.subarray(0,5))!=='%PDF-')throw new Error('The selected file is not a PDF');
    if(kind==='docx'&&(header[0]!==80||header[1]!==75))throw new Error('The selected file is not a DOCX ZIP document');
    const parsed=await extract(kind,buffer,signal);checkAbort(signal);
    documents=[{name:file.name,...parsed,originalFileSha256}];
  }else{
    let text;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer).replace(/^\uFEFF/,'');}catch{throw new Error('Text resumes must use UTF-8 encoding');}
    if(kind==='json'){
      let bundle;try{bundle=JSON.parse(text);}catch{throw new Error('The resume bundle is not valid JSON');}
      if(bundle.schema!=='formproof.resume-bundle.v1'||!Array.isArray(bundle.resumes)||!bundle.resumes.length||bundle.resumes.length>25)
        throw new Error('Expected a local resume bundle with 1–25 resumes');
      documents=bundle.resumes.map(r=>({name:r.name,text:r.text,parser:'Local importer bundle',originalFileSha256:r.sha256,warnings:[]}));
    }else documents=[{name:file.name,text,parser:'UTF-8 text',originalFileSha256,warnings:[]}];
  }
  const resumes=[];
  for(const document of documents){
    if(typeof document.name!=='string'||typeof document.text!=='string'||!document.text.trim()||document.text.length>250000)
      throw new Error('Resume text must be nonempty and under 250,000 characters');
    const sha256=await digest(new TextEncoder().encode(document.text));checkAbort(signal);
    const resume=parseResume(document.text,{name:document.name.slice(0,200),sha256,linePages:document.linePages});
    Object.assign(resume,{originalFileSha256:document.originalFileSha256,parser:document.parser,pages:document.pages??null,warnings:document.warnings});
    resumes.push(resume);
  }
  return resumes;
}
