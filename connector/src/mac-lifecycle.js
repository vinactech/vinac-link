// macOS instance lifecycle only. Does not read keys, peer records, messages or grant values.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isOlderVersion} from './version.js';

export const processHelper=fileURLToPath(new URL('../../mac-process',import.meta.url));
export const macLifecycleAvailable=()=>process.platform==='darwin'&&fs.existsSync(processHelper);
export function ownInstanceProof(home){return macLifecycleAvailable()?helper(['inspect',process.pid,home]):null;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function remaining(end){const n=end-Date.now();if(n<=0)throw Error('VINAC_STARTUP_DEADLINE: startup did not complete; no additional process was spawned.');return n;}
function helper(args,end=Date.now()+3000){return JSON.parse(execFileSync(processHelper,args.map(String),{encoding:'utf8',timeout:Math.min(3000,remaining(end)),maxBuffer:256*1024}));}
function metadata(home){try{return JSON.parse(fs.readFileSync(path.join(home,'daemon.json'),'utf8'));}catch{return null;}}
function ports(port){if(!Number.isInteger(port)||port<1||port>65534)throw Error('VINAC_PORT_RANGE');return [port,port+1];}
async function portFree(port,host){return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,host,()=>s.close(()=>resolve(true)));});}
export async function withLaunchLock(home,fn,{timeout=30000,lockName='.startup.lock'}={}){
  const end=Date.now()+timeout;
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  const lock=spawn(processHelper,['lock',path.join(home,lockName),String(remaining(end))],{stdio:['pipe','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(Error('VINAC_STARTUP_LOCK_TIMEOUT: another launch is still working.')),remaining(end));
      const done=f=>{clearTimeout(timer);f();};
      lock.once('error',e=>done(()=>reject(e)));
      lock.once('exit',code=>{if(!text.includes('LOCKED\n'))done(()=>reject(Error(`VINAC_STARTUP_LOCK_REJECTED (${code})`)));});
      lock.stdout.on('data',b=>{text+=b.toString();if(text.includes('LOCKED\n'))done(resolve);});
    });
    return await fn(end);
  }finally{
    lock.stdin.end();
    await Promise.race([new Promise(r=>lock.exitCode!==null?r():lock.once('exit',r)),pause(1000)]);
    if(lock.exitCode===null)lock.kill('SIGTERM');
  }
}

export async function inspectInstance(api,{end=Date.now()+6000}={}){
  const port=Number(api.port),[p1,p2]=ports(port),home=api.store.home,info=metadata(home);
  const owners=helper(['owners',p1,p2],end);
  let responsive=false,version=null;
  if(info?.port===p1&&info?.uiPort===p2){
    responsive=await api.attach();
    if(responsive)version=(await api.call('GET','/api/status',null,Math.min(1500,remaining(end))).catch(()=>null))?.version??null;
  }
  const candidate=owners.length===1&&owners[0].first&&owners[0].second&&info?.pid===owners[0].pid&&info?.port===p1&&info?.uiPort===p2;
  const proof=candidate?helper(['inspect',info.pid,home],end):null;
  const pinned=!info?.instance||(proof&&info.instance.start===proof.start&&info.instance.exe===proof.exe&&info.instance.uid===proof.uid);
  const verified=!!(proof?.eligible&&proof.uid===process.getuid()&&pinned);
  const free=owners.length===0&&await portFree(p1,process.env.VINAC_LAN_HOST??process.env.AGENTLINK_LAN_HOST??'0.0.0.0')&&await portFree(p2,'127.0.0.1');
  return {state:responsive?'HEALTHY':free?'FREE':verified?'UNRESPONSIVE_OWN':'PORT_CONFLICT',responsive,version,
    owners,proof,verified,home,port:p1,uiPort:p2,metadata_consistent:!!candidate};
}
function identityToken(state){return `${state.proof.pid}:${state.proof.start}`;}
function recoveryError(state,force=false){
  const prefix=force?'VINAC_FORCE_RECOVERY_REQUIRED':'VINAC_RECOVERY_REQUIRED';
  return Error(`${prefix}: verified VINAC PID ${state.proof.pid}; version ${state.version??'unknown'}; executable ${state.proof.exe}. VINAC_INSTANCE=${identityToken(state)}. ${force?'It did not stop after SIGTERM. Force Stop requires a separate explicit choice.':'Choose Restart VINAC to recover this instance; no process was spawned or terminated.'}`);
}
function conflictError(state){return Error(`VINAC_PORT_CONFLICT: ports ${state.port}/${state.uiPort} are occupied by ${state.owners.length?state.owners.map(o=>`PID ${o.pid} (uid ${o.uid}, ${o.first?state.port:''}${o.first&&o.second?'/':''}${o.second?state.uiPort:''})`).join(', '):'an owner that could not be verified'}. No unrelated process was stopped; no daemon was spawned.`);}
async function clearPorts(state,end,wait){
  const until=Math.min(end,Date.now()+wait);
  do{
    const owners=helper(['owners',state.port,state.uiPort],end);
    if(!owners.length&&await portFree(state.port,process.env.VINAC_LAN_HOST??'0.0.0.0')&&await portFree(state.uiPort,'127.0.0.1'))return true;
    await pause(100);
  }while(Date.now()<until);
  return false;
}
export async function stopVerified(state,{end=Date.now()+7000,force=false,expectedInstance}={}){
  if(!state.verified)throw conflictError(state);
  const current=metadata(state.home);
  if(current?.pid!==state.proof.pid)throw Error('VINAC_INSTANCE_CHANGED: profile metadata changed before stopping.');
  if(expectedInstance&&expectedInstance!==identityToken(state))throw Error('VINAC_INSTANCE_CHANGED: inspect again before recovering a different instance.');
  helper(['signal',state.proof.pid,state.proof.start,15,state.home,state.port,state.uiPort],end);
  if(await clearPorts(state,end,2500))return;
  if(!force)throw recoveryError(state,true);
  // The native helper repeats UID/signature/argv/profile/start-time and BOTH listener checks
  // immediately before signalling. A PID file or HTTP answer alone never grants this action.
  helper(['signal',state.proof.pid,state.proof.start,9,state.home,state.port,state.uiPort],end);
  if(!await clearPorts(state,end,1500))throw Error('VINAC_RECOVERY_PORTS_STILL_BUSY: no replacement was spawned.');
}
async function spawnOnce(api,end){
  const log=fs.openSync(path.join(api.store.home,'daemon.log'),'a',0o600);
  const logOffset=fs.fstatSync(log).size;
  const bin=fileURLToPath(new URL('../bin/vinac.mjs',import.meta.url));
  const args=[bin,'daemon','--home',api.store.home,'--port',String(api.port)];if(api.name)args.push('--name',api.name);
  let child;try{child=spawn(process.execPath,args,{detached:true,stdio:['ignore',log,log],windowsHide:true});child.unref();}finally{fs.closeSync(log);}
  let spawnError=null;child.once('error',e=>{spawnError=e;});
  const until=Math.min(end,Date.now()+12000);
  while(Date.now()<until){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)break;
    if(await api.attach())return 'started in the background';
    await pause(150);
  }
  // No in-process fallback and no second spawn. Keep any started process recorded for
  // explicit diagnosis/recovery; never kill an unidentified child by a stale PID.
  // Forward only known nonsecret failure categories from THIS attempt, never an old
  // log, message contents, tokens or arbitrary process output into a support report.
  let reason='the one background attempt did not become ready';
  try{
    const fd=fs.openSync(path.join(api.store.home,'daemon.log'),'r');
    try{
      const length=Math.min(8192,Math.max(0,fs.fstatSync(fd).size-logOffset));
      const buf=Buffer.alloc(length);fs.readSync(fd,buf,0,length,logOffset);const text=buf.toString();
      const damaged=text.match(/(?:identity\.json|history\.key\.json|peers\.json|messages\.enc)(?: is damaged| could not be decrypted)/);
      if(damaged)reason=damaged[0];
      else if(/security:|SecKeychain|User interaction is not allowed/.test(text))reason='macOS Keychain access failed (security: user action may be required)';
      else if(/EADDRINUSE/.test(text))reason='EADDRINUSE: ports became occupied during startup';
    }finally{fs.closeSync(fd);}
  }catch{}
  throw Error(`VINAC_STARTUP_FAILED: ${reason}. Private diagnostic: ${path.join(api.store.home,'daemon.log')}. No fallback daemon was started.`);
}
export async function managedConnect(api,{upgrade=false,recover=false,force=false,expectedInstance,version}={}){
  return withLaunchLock(api.store.home,async end=>{
    const s=await inspectInstance(api,{end});
    if(s.state==='HEALTHY'){
      if(!upgrade||!s.version||!isOlderVersion(s.version,version))return 'existing';
      if(!s.verified)throw Error('VINAC_UPGRADE_UNVERIFIED_INSTANCE: existing service was not stopped.');
      console.log(`Updating the running VINAC Link from ${s.version} to ${version} ...`);
      await stopVerified(s,{end,force:recover&&force,expectedInstance:recover?expectedInstance:undefined});
    }else if(s.state==='UNRESPONSIVE_OWN'){
      if(!recover)throw recoveryError(s);
      await stopVerified(s,{end,force,expectedInstance});
    }else if(s.state!=='FREE')throw conflictError(s);
    remaining(end);return spawnOnce(api,end);
  });
}
export async function managedStop(home,{force=false,expectedInstance}={}){
  if(!fs.existsSync(home))return {stopped:false,message:'VINAC Link is not running.'};
  return withLaunchLock(home,async end=>{
    const info=metadata(home);if(!info?.port)return {stopped:false,message:'No active VINAC instance is recorded.'};
    const port=Number(info.port),[p1,p2]=ports(port),owners=helper(['owners',p1,p2],end);
    if(!owners.length)return {stopped:false,message:'VINAC Link is not running.'};
    const candidate=owners.length===1&&owners[0].pid===info.pid&&owners[0].first&&owners[0].second&&info.uiPort===p2;
    const proof=candidate?helper(['inspect',info.pid,home],end):null;
    const pinned=!info.instance||(proof&&info.instance.start===proof.start&&info.instance.exe===proof.exe&&info.instance.uid===proof.uid);
    const s={home,port:p1,uiPort:p2,owners,proof,verified:!!proof?.eligible&&pinned,version:null};
    if(!s.verified)throw conflictError(s);
    await stopVerified(s,{end,force,expectedInstance});
    return {stopped:true,message:`Stopped verified VINAC Link (pid ${info.pid}).`};
  });
}
// Diagnostic adapter deliberately avoids Store/AgentApi constructors: inspecting an
// absent home must not create a profile or initialize any key/token.
export async function readOnlyStartupDiagnostics(home,port,{sample=false}={}){
  const info=metadata(home);
  const api={store:{home},port:port??info?.port??47800,base:null,token:null,
    async attach(){
      if(!info?.uiPort)return false;
      try{this.token=fs.readFileSync(path.join(home,'api-token'),'utf8').trim();}catch{return false;}
      this.base=`http://127.0.0.1:${info.uiPort}`;
      return !!await this.call('GET','/api/status',null,1500).catch(()=>null);
    },
    async call(method,route,body,timeout=1500){
      const r=await fetch(this.base+route,{method,headers:{authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(timeout)});
      if(!r.ok)throw Error('Diagnostic endpoint unavailable');return r.json();
    }};
  return startupDiagnostics(api,{sample});
}
export async function startupDiagnostics(api,{sample=false}={}){
  const s=await inspectInstance(api);let stackHeader=null;
  if(sample&&s.verified){
    // Explicit diagnostic request, a bounded sample of a freshly verified process.
    const fresh=helper(['inspect',s.proof.pid,s.home]);
    if(fresh.eligible&&fresh.start===s.proof.start){
      const out=execFileSync('/usr/bin/sample',[String(fresh.pid),'1','1'],{encoding:'utf8',timeout:5000,maxBuffer:512*1024,stdio:['ignore','pipe','pipe']});
      // Export function names/stack structure only; no memory dump, argv or key material.
      // Keep thread stacks only: omit process headers, binary-image paths and argv.
      const start=out.indexOf('Call graph:');const stop=out.indexOf('Binary Images:');
      stackHeader=start>=0?out.slice(start,stop>start?stop:out.length).slice(0,256*1024):'No stack frames available.';
    }
  }
  let installedVersion=null;
  try{installedVersion=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-','/Applications/VINAC Link.app/Contents/Info.plist'],{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','ignore']}).trim();}catch{}
  return {state:s.state,responsive:s.responsive,version:s.version,owners:s.owners,proof:s.proof,
    metadata_consistent:s.metadata_consistent,launched_version:JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version,
    installed_app:'/Applications/VINAC Link.app',installed_version:installedVersion,stack_sample:stackHeader,
    unknown_cpu_hang_cause:'NOT_ESTABLISHED',contains_keys_tokens_messages:false};
}
