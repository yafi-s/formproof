// End users receive these bundled assets; no npm operation runs in the extension.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),destination=path.join(root,'extension/vendor');
await mkdir(destination,{recursive:true});
const inputs=new Set();
for(const name of ['mammoth','fflate']){
  const built=await build({absWorkingDir:root,tsconfigRaw:{compilerOptions:{}},entryPoints:[`./tools/parser-entry/${name}.mjs`],
    outfile:path.join(destination,`${name}.mjs`),bundle:true,platform:'browser',format:'esm',
    target:'chrome120',minify:true,legalComments:'eof',metafile:true});
  Object.keys(built.metafile.inputs).forEach(p=>inputs.add(p.replaceAll('\\','/')));
}
const packages=new Set([...inputs].filter(p=>p.includes('node_modules/')).map(p=>{
  const suffix=p.split('node_modules/').at(-1).split('/');return suffix[0].startsWith('@')?suffix.slice(0,2).join('/'):suffix[0];
}));
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8')),manifest={packages:[],files:{}};
for(const name of [...packages].sort()){
  const directory=path.join(root,'node_modules',name),pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  const licenses=(await readdir(directory,{withFileTypes:true})).filter(f=>f.isFile()&&/^(license|copying|notice)/i.test(f.name));
  if(!licenses.length)throw new Error(`Missing license for bundled ${name}`);
  const folder=path.join(destination,'licenses',name.replaceAll('/','__'));await mkdir(folder,{recursive:true});
  for(const license of licenses)await copyFile(path.join(directory,license.name),path.join(folder,license.name));
  manifest.packages.push({name,version:pkg.version,license:pkg.license,integrity:lock.packages[`node_modules/${name}`]?.integrity});
}
for(const name of ['mammoth.mjs','fflate.mjs'])manifest.files[name]=createHash('sha256').update(await readFile(path.join(destination,name))).digest('hex');
await writeFile(path.join(destination,'parser-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({bundled:manifest.packages.map(p=>`${p.name}@${p.version}`),files:manifest.files},null,2));
