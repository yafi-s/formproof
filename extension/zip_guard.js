// Preflight and bounded streaming validation BEFORE the DOCX reader sees a ZIP.
import {Unzip,UnzipInflate} from './vendor/fflate.mjs';
const MAX_ENTRY=4*1024*1024,MAX_TOTAL=16*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function safeName(name){
  if(!name||name.length>512||/[:\\\x00]/.test(name)||name.startsWith('/')||
      name.replace(/\/$/,'').split('/').some(p=>!p||['.','..','__proto__','prototype','constructor'].includes(p)))
    throw new Error('Unsafe DOCX archive path');
  return name;
}
function extra(view,start,length){
  const end=start+length;
  while(start<end){if(start+4>end)throw new Error('Malformed DOCX ZIP metadata');
    const type=view.getUint16(start,true),size=view.getUint16(start+2,true);start+=4;
    if(type===1)throw new Error('ZIP64 DOCX archives are unsupported');
    start+=size;if(start>end)throw new Error('Malformed DOCX ZIP metadata');}
}
export function validateDocxZip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length<22)throw new Error('This is not a valid DOCX archive');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)
    if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('Unsupported DOCX archive');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(!count||count>256||count!==view.getUint16(end+8,true)||offset+size!==end)throw new Error('DOCX archive exceeds supported structure limits');
  const entries=new Map();let position=offset,total=0;
  for(let n=0;n<count;n++){
    if(position+46>end||view.getUint32(position,true)!==0x02014b50)throw new Error('Malformed DOCX directory');
    const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true),crc=view.getUint32(position+16,true),
      compressed=view.getUint32(position+20,true),uncompressed=view.getUint32(position+24,true),
      nameLength=view.getUint16(position+28,true),extraLength=view.getUint16(position+30,true),commentLength=view.getUint16(position+32,true),
      local=view.getUint32(position+42,true),next=position+46+nameLength+extraLength+commentLength;
    if(flags&1)throw new Error('Password-protected DOCX files are unsupported');
    if(![0,8].includes(method)||next>end||view.getUint16(position+34,true)||uncompressed>MAX_ENTRY||(total+=uncompressed)>MAX_TOTAL)
      throw new Error('DOCX archive exceeds safe extraction limits');
    const name=safeName(decoder.decode(bytes.subarray(position+46,position+46+nameLength)));
    if(entries.has(name))throw new Error('Duplicate DOCX archive entry');
    extra(view,position+46+nameLength,extraLength);
    if(local+30>offset||view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method)
      throw new Error('Inconsistent DOCX local header');
    const ln=view.getUint16(local+26,true),le=view.getUint16(local+28,true),dataStart=local+30+ln+le;
    if(dataStart+compressed>offset||decoder.decode(bytes.subarray(local+30,local+30+ln))!==name)
      throw new Error('Inconsistent DOCX entry');
    const lc=view.getUint32(local+18,true),lu=view.getUint32(local+22,true);
    if((flags&8)?((lc!==0&&lc!==compressed)||(lu!==0&&lu!==uncompressed)):(lc!==compressed||lu!==uncompressed))
      throw new Error('Inconsistent DOCX sizes');
    extra(view,local+30+ln,le);
    entries.set(name,{uncompressed,crc});position=next;
  }
  if(position!==end||!entries.has('word/document.xml')||!entries.has('[Content_Types].xml'))throw new Error('DOCX document content is missing');
  let actualTotal=0,finished=0;const seen=new Set();
  const unzip=new Unzip(file=>{
    const entry=entries.get(file.name);
    if(!entry||seen.has(file.name))throw new Error('Unexpected DOCX entry');seen.add(file.name);
    let length=0,crc=0xffffffff;
    file.ondata=(error,data,final)=>{
      if(error)throw error;
      length+=data.length;actualTotal+=data.length;
      if(length>entry.uncompressed||length>MAX_ENTRY||actualTotal>MAX_TOTAL)throw new Error('DOCX decompression limit exceeded');
      for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);
      if(final){if(length!==entry.uncompressed||((crc^0xffffffff)>>>0)!==entry.crc)throw new Error('Corrupt DOCX archive');finished++;}
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input chunks bound each synchronous inflate allocation before the callback can reject it.
  for(let p=0;p<bytes.length;p+=512)unzip.push(bytes.subarray(p,p+512),p+512>=bytes.length);
  if(finished!==entries.size)throw new Error('Incomplete DOCX archive');
  return {entries:entries.size,uncompressedBytes:actualTotal};
}
