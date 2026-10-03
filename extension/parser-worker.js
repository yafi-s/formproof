// Dedicated worker: no DOM output, credentials, network endpoints or file-system access.
const TEXT_LIMIT=250000;
self.onmessage=async({data:{kind,buffer}})=>{
  try{
    let result;
    if(kind==='pdf'){
      const pdfjs=await import('./vendor/pdfjs/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/build/pdf.worker.min.mjs',import.meta.url).href;
      // A parser worker has no window.location. Supply a nested, local module worker
      // explicitly so PDF.js never falls back to installing its protocol on this worker.
      pdfjs.GlobalWorkerOptions.workerPort=new Worker(pdfjs.GlobalWorkerOptions.workerSrc,{type:'module'});
      const loading=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useWasm:false,
        isImageDecoderSupported:false,disableFontFace:true,useSystemFonts:false,
        cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
        standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href});
      let encrypted=false;
      loading.onPassword=()=>{encrypted=true;loading.destroy();};
      let pdf;
      try{pdf=await loading.promise;}catch(error){throw new Error(encrypted||error.name==='PasswordException'?'Password-protected PDFs are unsupported':'PDF could not be read; encrypted or damaged files are unsupported');}
      try{
        if(pdf.numPages>25)throw new Error('PDFs must contain 25 pages or fewer');
        const lines=[],linePages=[];let characters=0;
        for(let number=1;number<=pdf.numPages;number++){
          const page=await pdf.getPage(number),content=await page.getTextContent();let line='',lastY=null;
          const flush=()=>{if(line.trim()){lines.push(line.trim());linePages.push(number);line='';}};
          for(const item of content.items){
            if(typeof item.str!=='string')continue;
            characters+=item.str.length;if(characters>TEXT_LIMIT)throw new Error('Extracted resume text exceeds 250,000 characters');
            const y=item.transform?.[5];if(lastY!==null&&Math.abs(y-lastY)>2)flush();
            line+=(line&&!line.endsWith(' ')?' ':'')+item.str;lastY=y;if(item.hasEOL)flush();
          }
          flush();page.cleanup();
        }
        const text=lines.join('\n');
        if(!text.trim())throw new Error('No PDF text layer found. Scanned resumes need local OCR or a text/DOCX export.');
        result={text,linePages,pages:pdf.numPages,parser:`PDF.js ${pdfjs.version} text layer`,warnings:['PDF text order can differ from the visual layout. Review every source excerpt.']};
      }finally{await loading.destroy();pdfjs.GlobalWorkerOptions.workerPort?.terminate();}
    }else if(kind==='docx'){
      const {validateDocxZip}=await import('./zip_guard.js');validateDocxZip(buffer);
      const {extractRawText}=await import('./vendor/mammoth.mjs');
      const extracted=await extractRawText({arrayBuffer:buffer});
      const text=extracted.value.replace(/\r\n?/g,'\n');
      if(text.length>TEXT_LIMIT)throw new Error('Extracted resume text exceeds 250,000 characters');
      if(!text.trim())throw new Error('No readable DOCX text found. Export a text-based resume.');
      result={text,parser:'Mammoth 1.13.0 raw text',warnings:['DOCX text extraction omits layout and pagination. Review every source excerpt.',...extracted.messages.map(m=>m.message.slice(0,300))].slice(0,10)};
    }else throw new Error('Unsupported parser format');
    self.postMessage({ok:true,result});
  }catch(error){self.postMessage({ok:false,error:error.message?.slice(0,400)||'Resume could not be parsed'});}
};
