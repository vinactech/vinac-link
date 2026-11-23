// Owner-confirmed macOS install/update transaction. Never changes profiles or Keychain items.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync,execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {isOlderVersion} from './version.js';
import {withLaunchLock,inspectInstance,stopVerified} from './mac-lifecycle.js';

const run=promisify(execFile);
const bundle=fileURLToPath(new URL('../../../../',import.meta.url));
export function bundleInfo(app){
  const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(app,'Contents/Info.plist')],{encoding:'utf8',timeout:2000,maxBuffer:65536}));
  if(info.CFBundleIdentifier!=='tech.vinac.link')throw Error('VINAC_INSTALL_DIFFERENT_APPLICATION');
  return info;
}
export function verifyBundle(app){
  const st=fs.lstatSync(app);if(!st.isDirectory()||st.isSymbolicLink())throw Error('VINAC_INSTALL_UNSAFE_BUNDLE');
  bundleInfo(app);
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe',timeout:10000});
  return true;
}
function verifyOwnedBundle(app){
  verifyBundle(app);
  const r=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',app],{encoding:'utf8',timeout:3000});
  if(r.status!==0||!r.stderr.includes('TeamIdentifier=GC4QJCRB4P'))throw Error('VINAC_INSTALL_UNEXPECTED_SIGNER');
}
// Only reuse an already-installed copy when both complete signed bundles are
// the exact same owner-signed release. A version string alone is insufficient.
export function sameInstalledRelease(source,target,version){
  try{
    verifyOwnedBundle(source);verifyOwnedBundle(target);
    if(bundleInfo(source).CFBundleShortVersionString!==version||bundleInfo(target).CFBundleShortVersionString!==version)return false;
    const hash=app=>{
      const r=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',app],{encoding:'utf8',timeout:3000});
      if(r.status!==0)throw Error('VINAC_INSTALL_SIGNATURE_UNAVAILABLE');
      const h=r.stderr.match(/^CDHash=([0-9a-f]{40,64})$/mi)?.[1];
      if(!h)throw Error('VINAC_INSTALL_SIGNATURE_UNAVAILABLE');return h;
    };
    return hash(source)===hash(target);
  }catch{return false;}
}
export function canReuseInstalledState(s,installedRuntime,version){
  if(s.state==='FREE')return true;
  if(s.state!=='HEALTHY'||!s.verified||s.version!==version)return false;
  try{return fs.realpathSync(s.proof.exe)===fs.realpathSync(installedRuntime);}catch{return false;}
}
export async function ask(message,choices){
  const script='on run a\nset opts to items 2 thru -1 of a\nset answer to display alert "VINAC Link" message (item 1 of a) buttons opts default button (item 1 of opts)\nreturn button returned of answer\nend run\n';
  const child=execFile('/usr/bin/osascript',['-',message,...choices],{maxBuffer:4096},()=>{});
  child.stdin.end(script);
  return new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>out+=b);child.once('error',reject);child.once('exit',code=>code===0?resolve(out.trim()):reject(Error('VINAC_INSTALL_CANCELLED')));});
}
async function prepareReplacement(api,incomingVersion,confirm){
  return withLaunchLock(api.store.home,async end=>{
    const s=await inspectInstance(api,{end});
    if(s.state==='FREE')return;
    if(s.state==='HEALTHY'&&s.version&&isOlderVersion(incomingVersion,s.version))throw Error(`VINAC_INSTALL_NEWER_RUNNING: version ${s.version} is already running; no downgrade was performed.`);
    if(!s.verified)throw Error('VINAC_INSTALL_PORT_CONFLICT: an existing listener was not verified as this profile; it was not stopped.');
    if(s.state==='UNRESPONSIVE_OWN'){
      const answer=await confirm(`VINAC PID ${s.proof.pid} is not responding. Restart this verified instance before installing? Executable: ${s.proof.exe}. Version unknown.`,['Cancel','Restart VINAC']);
      if(answer!=='Restart VINAC')throw Error('VINAC_INSTALL_CANCELLED');
    }
    try{await stopVerified(s,{end:s.state==='UNRESPONSIVE_OWN'?Date.now()+7000:end});}
    catch(e){
      if(!e.message.startsWith('VINAC_FORCE_RECOVERY_REQUIRED'))throw e;
      const answer=await confirm(`Verified VINAC PID ${s.proof.pid} did not stop. Force Stop this exact instance? No other process will be terminated.`,['Cancel','Force Stop']);
      if(answer!=='Force Stop')throw Error('VINAC_INSTALL_CANCELLED');
      // A new machine-work deadline begins only after the separate human confirmation.
      await stopVerified(s,{end:Date.now()+6000,force:true,expectedInstance:`${s.proof.pid}:${s.proof.start}`});
    }
  });
}
export async function installTransaction({source,target,verify=verifyOwnedBundle,beforeReplace=async()=>{},launch,afterFailure=async()=>{},copy=(a,b)=>execFileSync('/usr/bin/ditto',[a,b],{timeout:30000,stdio:'pipe'})}){
  const parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
  if(fs.lstatSync(parent).isSymbolicLink()||path.basename(target)!=='VINAC Link.app')throw Error('VINAC_INSTALL_UNSAFE_TARGET');
  verify(source);const incoming=bundleInfo(source).CFBundleShortVersionString;
  if(fs.existsSync(target)){
    verify(target);const existing=bundleInfo(target).CFBundleShortVersionString;
    if(isOlderVersion(incoming,existing))return {reused_newer:true,version:existing,target};
  }
  const id=crypto.randomUUID(),stage=path.join(parent,`.vinac-stage-${id}.app`),backup=path.join(parent,`.vinac-rollback-${id}.app`),failed=path.join(parent,`.vinac-failed-${id}.app`);
  let replaced=false,hadOld=false;
  try{
    copy(source,stage);verify(stage);
    await beforeReplace();
    if(fs.existsSync(target)){
      if(fs.lstatSync(target).isSymbolicLink())throw Error('VINAC_INSTALL_UNSAFE_TARGET');
      verify(target);fs.renameSync(target,backup);hadOld=true;
    }
    try{fs.renameSync(stage,target);replaced=true;}catch(e){if(hadOld&&!fs.existsSync(target))fs.renameSync(backup,target);throw e;}
    try{await launch(target);}catch(e){
      // Stop/inspect only a verified candidate before rollback; otherwise retain both copies.
      await afterFailure();
      if(fs.existsSync(target))fs.renameSync(target,failed);
      if(hadOld)fs.renameSync(backup,target);
      let restarted=false;if(hadOld){try{await launch(target);restarted=true;}catch{}}
      throw Error(`VINAC_INSTALL_START_FAILED: ${e.message}. Previous app ${hadOld?'restored'+(restarted?' and restarted':' (restart requires attention)'):'was not present'}; failed copy retained at ${failed}.`);
    }
    return {installed:true,version:incoming,target,rollback:hadOld?backup:null};
  }finally{
    if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});
  }
}
export async function maybeInstallFromVolume({api,version,explicitHome=false,noOpen=false,openPage}){
  if(process.platform!=='darwin'||!(bundle.startsWith('/Volumes/')||bundle.includes('/AppTranslocation/'))||explicitHome||process.env.VINAC_NO_BROWSER==='1')return false;
  let parent='/Applications';try{fs.accessSync(parent,fs.constants.W_OK);}catch{parent=path.join(os.homedir(),'Applications');}
  const target=path.join(parent,'VINAC Link.app');
  const launch=async app=>{
    const arch=process.arch==='arm64'?'arm64':'x64',resources=path.join(app,'Contents/Resources');
    const args=[path.join(resources,'connector/bin/vinac.mjs'),'start','--home',api.store.home,'--port',String(api.port),'--no-open'];
    await run(path.join(resources,'node',arch,'bin/node'),args,{timeout:30000,maxBuffer:65536});
    if(!await api.attach())throw Error('Installed service did not become responsive.');
    if(!noOpen)openPage((await api.call('GET','/api/status')).approvalPage);
  };
  // macOS may translocate even a launcher opened from Applications. Reuse an
  // identical verified installed release instead of presenting Install again.
  if(sameInstalledRelease(bundle,target,version)){
    const arch=process.arch==='arm64'?'arm64':'x64';
    const installedRuntime=path.join(target,'Contents/Resources/node',arch,'bin/node');
    const state=await inspectInstance(api);
    if(canReuseInstalledState(state,installedRuntime,version)){
      await launch(target);
      console.log(`VINAC Link is using the installed copy at ${target}.`);return true;
    }
  }
  const answer=await ask(`Install or update VINAC Link ${version} in ${parent}, then start the installed copy? Running a long-lived service from this installer volume is not supported. Existing keys, pairings and history are retained.`,['Cancel','Install / Update']);
  if(answer!=='Install / Update')throw Error('VINAC_INSTALL_CANCELLED: no service was started from the disk image.');
  const result=await withLaunchLock(api.store.home,()=>installTransaction({source:bundle,target,
    beforeReplace:()=>prepareReplacement(api,version,ask),launch,
    afterFailure:()=>prepareReplacement(api,version,ask)}),{timeout:45000,lockName:'.install.lock'});
  if(result.reused_newer)await launch(target);
  console.log(`VINAC Link is using the installed copy at ${target}.`);return true;
}
