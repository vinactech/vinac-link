import { bitsToBytes, bytesToBits, clamp } from './bytes.js';
import { expectedFrameLength, FIXED_FRAME_BYTES, MAX_PAYLOAD_BYTES, parseFrame } from './frame.js';
const MAX_FRAME_BYTES=FIXED_FRAME_BYTES+MAX_PAYLOAD_BYTES;
const MAX_NSYM=64;
import { fecEncode, fecDecodeHeader, fecDecodeBody, fecRawFrame, codedLength, HEADER_BYTES } from './fec.js';

export const PROFILES = Object.freeze({
  slow:{id:5,label:'Slow',rawBps:25},
  compat:{id:0,label:'Compatibility',rawBps:50},
  robust:{id:1,label:'Robust',rawBps:100},
  balanced:{id:2,label:'Balanced',rawBps:250},
  fast:{id:3,label:'Fast',rawBps:500},
  experimental:{id:4,label:'Experimental',rawBps:1000}
});
export const PROFILE_BY_ID=Object.freeze(Object.fromEntries(Object.entries(PROFILES).map(([k,v])=>[v.id,{...v,key:k}])));

export const START_SYMBOLS=Object.freeze([3,3,3,3,3,3,3,3]);
export const PREAMBLE_SYMBOLS=Object.freeze(Array.from({length:24},(_,i)=>i%4));
export const TRAINING_SYMBOLS=Object.freeze([...START_SYMBOLS,...PREAMBLE_SYMBOLS]);

// v2 frames: a non-repeating training pattern (each tone 6 times in the
// preamble, so it also measures every tone's level) and Reed-Solomon coding.
export const START_V2=Object.freeze([0,3,0,3,0,3,0,3]);
export const PREAMBLE_V2=Object.freeze([2,0,3,1,1,3,0,2,3,2,1,0,0,1,2,3,1,2,3,0,2,3,0,1]);
export const TRAINING_V2=Object.freeze([...START_V2,...PREAMBLE_V2]);
export function framedFskSymbolsV2(bytes,nsym=32){ return [...TRAINING_V2,...bytesToFskSymbols(fecEncode(bytes,nsym))]; }

export function toneSetForSampleRate(sampleRate,{low=17400,spacing=600}={}){
  const nyq=sampleRate/2;
  let top=low+spacing*3;
  if(top > nyq-900){ low=Math.max(14500,nyq-900-spacing*3); top=low+spacing*3; }
  return [low,low+spacing,low+spacing*2,top].map(Math.round);
}

export function bytesToFskSymbols(bytes){
  const bits=bytesToBits(bytes); const out=[];
  for(let i=0;i<bits.length;i+=2){ out.push(parseInt(bits.slice(i,i+2).padEnd(2,'0'),2)); }
  return out;
}
export function fskSymbolsToBytes(symbols){
  let bits=''; for(const s of symbols) bits += (s&3).toString(2).padStart(2,'0'); return bitsToBytes(bits);
}
export function framedFskSymbols(bytes){ return [...TRAINING_SYMBOLS,...bytesToFskSymbols(bytes)]; }

export function goertzelPower(samples,start,length,freq,sampleRate){
  const end=Math.min(samples.length,start+length); if(end-start<8) return 0;
  const w=2*Math.PI*freq/sampleRate; const coeff=2*Math.cos(w); let s0=0,s1=0,s2=0;
  for(let i=start;i<end;i++){ s0=samples[i]+coeff*s1-s2; s2=s1;s1=s0; }
  return Math.max(0,s1*s1+s2*s2-coeff*s1*s2)/(end-start);
}

// `eq` (optional) evens out tones that arrive louder or softer: each tone's
// power is reduced by its echo floor and divided by its measured level.
export function classifyFsk(samples,start,length,tones,sampleRate,eq=null){
  const raw=tones.map(f=>goertzelPower(samples,start,length,f,sampleRate));
  const powers=eq?raw.map((p,k)=>Math.max(0,p-eq.floor[k])/eq.gain[k]):raw;
  let best=0,second=0,bestIdx=0;
  for(let i=0;i<powers.length;i++){const p=powers[i];if(p>best){second=best;best=p;bestIdx=i}else if(p>second)second=p;}
  const ratio=(best+1e-12)/(second+1e-12);
  return {symbol:bestIdx,powers,best,second,ratio,snrProxyDb:10*Math.log10(ratio)};
}

function trainingScore(samples,offset,symSamples,tones,sampleRate,training=TRAINING_SYMBOLS){
  let matches=0, snr=0;
  for(let j=0;j<training.length;j++){
    const c=classifyFsk(samples,Math.round(offset+j*symSamples),Math.round(symSamples*.9),tones,sampleRate);
    if(c.symbol===training[j]) matches++;
    snr+=c.snrProxyDb;
  }
  return {score:matches/training.length,snr:snr/training.length};
}

export function findFskTraining(samples,{sampleRate,rawBps,tones,training=TRAINING_SYMBOLS}){
  const symbolRate=rawBps/2; const symSamples=sampleRate/symbolRate;
  const quarter=Math.max(8,Math.round(symSamples/4));
  const need=Math.ceil((training.length+8)*symSamples);
  if(samples.length<need) return null;
  const classes=[];
  for(let start=0;start+symSamples<samples.length;start+=quarter){
    classes.push(classifyFsk(samples,start,Math.round(symSamples*.85),tones,sampleRate));
  }
  let best={score:0,index:-1,snr:0};
  const stride=Math.max(1,Math.round(symSamples/quarter));
  const train=training;
  for(let i=0;i+stride*(train.length-1)<classes.length;i++){
    let m=0,s=0;
    for(let j=0;j<train.length;j++){const c=classes[i+j*stride];if(c.symbol===train[j])m++;s+=c.snrProxyDb;}
    const score=m/train.length;
    if(score>best.score) best={score,index:i,snr:s/train.length};
  }
  if(best.index<0 || best.score<0.72) return null;
  const coarse=best.index*quarter;
  let refined={offset:coarse,score:best.score,snr:best.snr};
  const span=Math.max(4,Math.round(symSamples/3)); const step=Math.max(2,Math.round(symSamples/24));
  for(let off=Math.max(0,coarse-span);off<=coarse+span;off+=step){
    const t=trainingScore(samples,off,symSamples,tones,sampleRate,training);
    if(t.score>refined.score || (t.score===refined.score && t.snr>refined.snr)) refined={offset:off,score:t.score,snr:t.snr};
  }
  return {...refined,symSamples};
}

// Measure how loud each tone arrives, using the 24 preamble symbols (0,1,2,3
// repeated) that end right before dataStart. gain = level when that tone is
// sent; floor = level while other tones are sent (echo and leakage).
export function estimateEqualizer(samples,dataStart,symSamples,tones,sampleRate,win,preamble=PREAMBLE_SYMBOLS){
  const n=preamble.length, first=dataStart-n*symSamples;
  if(first<0) return null;
  const len=Math.max(16,Math.round(symSamples*win.len)), skip=Math.round(symSamples*win.start);
  const on=[0,0,0,0], onN=[0,0,0,0], off=[0,0,0,0], offN=[0,0,0,0];
  for(let j=0;j<n;j++){
    const s=Math.round(first+j*symSamples)+skip, sent=preamble[j];
    tones.forEach((f,k)=>{const p=goertzelPower(samples,s,len,f,sampleRate);if(k===sent){on[k]+=p;onN[k]++;}else{off[k]+=p;offN[k]++;}});
  }
  const floor=off.map((x,k)=>x/offN[k]), gain=on.map((x,k)=>Math.max(1e-12,x/onN[k]-floor[k]));
  return {floor,gain};
}

// Read one frame's symbols starting at dataStart. `win` places the measurement
// window inside each symbol: a later window skips the echo of the previous tone.
function readFrameAt(samples,dataStart,symSamples,tones,sampleRate,win,useEq=false){
  if(dataStart<0) return {status:'BAD_OFFSET'};
  const maxSymbols=Math.floor((samples.length-dataStart)/symSamples);
  if(maxSymbols<FIXED_FRAME_BYTES*4) return {status:'INCOMPLETE'};
  const eq=useEq?estimateEqualizer(samples,dataStart,symSamples,tones,sampleRate,win):null;
  if(useEq&&!eq) return {status:'BAD_OFFSET'};
  const symbols=[]; let snr=0;
  const len=Math.max(16,Math.round(symSamples*win.len)), skip=Math.round(symSamples*win.start);
  for(let j=0;j<maxSymbols;j++){
    const c=classifyFsk(samples,Math.round(dataStart+j*symSamples)+skip,len,tones,sampleRate,eq);
    symbols.push(c.symbol); snr+=c.snrProxyDb;
    if(symbols.length===22*4){
      const expected=expectedFrameLength(fskSymbolsToBytes(symbols));
      if(expected>maxSymbols/4) return {status:'INCOMPLETE'};
    }
    if(symbols.length>=22*4){
      const expected=expectedFrameLength(fskSymbolsToBytes(symbols));
      if(expected && symbols.length>=expected*4){
        const frameBytes=fskSymbolsToBytes(symbols.slice(0,expected*4)).slice(0,expected);
        return {status:'READ',frameBytes,snr:snr/symbols.length,symbols:expected*4};
      }
    }
  }
  return {status:'INCOMPLETE'};
}

const WINDOWS=Object.freeze([{start:.06,len:.88},{start:.40,len:.56},{start:.55,len:.42}]);
const SYMBOL_SHIFTS=Object.freeze([0,-4,4,-1,1,-2,2,-3,3,-8,8]);

// Reads `count` bytes starting at `start`, with a per-byte confidence (the
// weakest of its 4 tone decisions).
function readBytes(samples,start,count,sym,tones,sampleRate,win,eq){
  const len=Math.max(16,Math.round(sym*win.len)), skip=Math.round(sym*win.start);
  const symbols=[], conf=[]; let snr=0;
  for(let j=0;j<count*4;j++){
    const c=classifyFsk(samples,Math.round(start+j*sym)+skip,len,tones,sampleRate,eq);
    symbols.push(c.symbol); snr+=c.snrProxyDb;
    if(j%4===0) conf.push(c.snrProxyDb); else conf[conf.length-1]=Math.min(conf[conf.length-1],c.snrProxyDb);
  }
  return {bytes:fskSymbolsToBytes(symbols).slice(0,count),conf,snr:snr/Math.max(1,symbols.length)};
}

// v2 decode: find the v2 training, read and repair the length header, wait for
// the whole coded frame, then repair the body. Tries a few measurement windows
// and fine alignments; accepts only a repaired frame whose CRC also matches.
// Returns null when no v2 training is present (caller falls back to v1).
// minLength/maxLength/accept let other frame types (the AgentLink pairing
// beacon) reuse this decoder; the defaults are the lab message frame.
export function decodeFskFrameV2(samples,{sampleRate,rawBps,tones,minLength=FIXED_FRAME_BYTES,maxLength=MAX_FRAME_BYTES,accept=b=>parseFrame(b).ok}){
  const found=findFskTraining(samples,{sampleRate,rawBps,tones,training:TRAINING_V2});
  if(!found) return null;
  const sym=found.symSamples, base=found.offset+TRAINING_V2.length*sym;
  let fallback=null, sawHeader=false, waiting=false;
  for(const f of [0,-.25,.25,-.12,.12]){
    const start=base+f*sym;
    for(const win of WINDOWS){
      for(const useEq of [true,false]){
        const eq=useEq?estimateEqualizer(samples,start,sym,tones,sampleRate,win,PREAMBLE_V2):null;
        if(start+HEADER_BYTES*4*sym>samples.length) return {ok:false,reason:'INCOMPLETE_AUDIO',training:found};
        const h=readBytes(samples,start,HEADER_BYTES,sym,tones,sampleRate,win,eq);
        let header=null;
        const hOrder=h.conf.map((c,i)=>({c,i})).sort((a,b)=>a.c-b.c).map(x=>x.i);
        for(const e of [0,2,4,6]){try{header=fecDecodeHeader(h.bytes,hOrder.slice(0,e));break;}catch{}}
        if(!header||header.length<minLength||header.length>maxLength) continue;
        const {length,nsym}=header;
        const coded=codedLength(length,nsym), bodyBytes=coded-HEADER_BYTES;
        const bodyStart=start+HEADER_BYTES*4*sym, end=start+coded*4*sym;
        if(end>samples.length){
          // Another reading may decode the header differently, so keep trying.
          // Wait for more audio only while a frame that size could still be
          // arriving; past the longest possible frame, this header was misread.
          if(samples.length<start+codedLength(maxLength,MAX_NSYM)*4*sym+sampleRate) waiting=true;
          continue;
        }
        sawHeader=true;
        const b=readBytes(samples,bodyStart,bodyBytes,sym,tones,sampleRate,win,eq);
        const result={startSample:found.offset,endSample:Math.round(end),trainingScore:found.score,snrProxyDb:b.snr,symbolsDecoded:coded*4,formatVersion:2,fecStrength:nsym};
        try{
          const r=fecDecodeBody(b.bytes,length,b.conf,nsym);
          if(accept(r.frame)) return {ok:true,frameBytes:r.frame,fecCorrected:r.corrected,...result};
        }catch{}
        if(!fallback) fallback={ok:true,frameBytes:fecRawFrame(b.bytes,length,nsym),fecFailed:true,...result};
      }
    }
  }
  if(waiting) return {ok:false,reason:'INCOMPLETE_AUDIO',training:found};
  if(fallback) return fallback; // reported as a rejected frame; the buffer moves on
  // No usable header. Once a whole maximum-size frame could have arrived,
  // report it as rejected so the receiver moves past this training.
  if(samples.length>base+codedLength(maxLength,MAX_NSYM)*4*sym+sampleRate||sawHeader){
    return {ok:true,frameBytes:new Uint8Array(minLength),fecFailed:true,startSample:found.offset,endSample:Math.round(base+HEADER_BYTES*4*sym),trainingScore:found.score,snrProxyDb:0,symbolsDecoded:0,formatVersion:2};
  }
  return {ok:false,reason:'INCOMPLETE_AUDIO',training:found};
}

export function decodeFskFrame(samples,opts){
  const v2=decodeFskFrameV2(samples,opts);
  if(v2&&(v2.ok||v2.reason==='INCOMPLETE_AUDIO')) return v2;
  return decodeFskFrameV1(samples,opts);
}

export function decodeFskFrameV1(samples,{sampleRate,rawBps,tones}){
  const found=findFskTraining(samples,{sampleRate,rawBps,tones});
  if(!found) return {ok:false,reason:'PREAMBLE_MISS'};
  const sym=found.symSamples;
  const baseStart=found.offset+TRAINING_SYMBOLS.length*sym;
  const done=(r,start)=>({ok:true,frameBytes:r.frameBytes,startSample:Math.round(start-TRAINING_SYMBOLS.length*sym),endSample:Math.round(start+r.symbols*sym),trainingScore:found.score,snrProxyDb:r.snr,symbolsDecoded:r.symbols});
  // First reading: the training alignment as found, then the same with tone
  // equalization from the preamble.
  const first=readFrameAt(samples,baseStart,sym,tones,sampleRate,WINDOWS[0]);
  if(first.status==='INCOMPLETE'||first.status==='BAD_OFFSET') return {ok:false,reason:'INCOMPLETE_AUDIO',training:found};
  if(parseFrame(first.frameBytes).ok) return done(first,baseStart);
  for(const win of WINDOWS){
    const r=readFrameAt(samples,baseStart,sym,tones,sampleRate,win,true);
    if(r.status==='READ'&&parseFrame(r.frameBytes).ok) return done(r,baseStart);
  }
  // The repeating training pattern can lock a whole number of symbols early or
  // late, and room echo smears tones into the next symbol. Search nearby
  // alignments and later measurement windows; accept only a CRC-valid frame.
  const fine=[0,-.25,.25,-.12,.12,-.38,.38];
  for(const shift of SYMBOL_SHIFTS){
    for(const f of fine){
      const start=baseStart+(shift+f)*sym;
      for(const win of WINDOWS){
        for(const useEq of [false,true]){
          if(shift===0&&f===0&&(useEq||win===WINDOWS[0])) continue;
          const r=readFrameAt(samples,start,sym,tones,sampleRate,win,useEq);
          if(r.status==='READ'&&parseFrame(r.frameBytes).ok) return done(r,start);
        }
      }
    }
  }
  return {ok:true,frameBytes:first.frameBytes,startSample:found.offset,endSample:Math.round(baseStart+first.symbols*sym),trainingScore:found.score,snrProxyDb:first.snr,symbolsDecoded:first.symbols};
}

export function synthesizeFsk(symbols,{sampleRate=48000,rawBps=250,tones=toneSetForSampleRate(sampleRate),amplitude=.5,leadingMs=80,trailingMs=100}={}){
  const symRate=rawBps/2, symSamples=sampleRate/symRate;
  const lead=Math.round(sampleRate*leadingMs/1000), trail=Math.round(sampleRate*trailingMs/1000);
  const n=lead+Math.ceil(symbols.length*symSamples)+trail; const out=new Float32Array(n); let phase=0;
  const fade=Math.max(1,Math.round(sampleRate*.008));
  for(let s=0;s<symbols.length;s++){
    const start=lead+Math.round(s*symSamples), end=lead+Math.round((s+1)*symSamples); const f=tones[symbols[s]&3];
    for(let i=start;i<end && i<out.length;i++){
      let env=1; const rel=i-lead, remaining=(lead+symbols.length*symSamples)-i;
      if(rel<fade)env=rel/fade; if(remaining<fade)env=Math.min(env,remaining/fade);
      out[i]=Math.sin(phase)*amplitude*clamp(env,0,1); phase += 2*Math.PI*f/sampleRate; if(phase>Math.PI*2)phase-=Math.PI*2;
    }
  }
  return out;
}

export function syntheticClap(sampleRate=48000,duration=.8){
  const out=new Float32Array(Math.round(sampleRate*duration)); const center=Math.round(out.length*.35), width=Math.round(sampleRate*.006);
  for(let i=0;i<out.length;i++){const d=Math.abs(i-center); if(d<width) out[i]=(Math.random()*2-1)*Math.exp(-d/(width*.18));}
  return out;
}
export function syntheticSpeechBand(sampleRate=48000,duration=2){
  const out=new Float32Array(Math.round(sampleRate*duration)); const freqs=[170,280,540,910,1430,2280];
  for(let i=0;i<out.length;i++){const t=i/sampleRate;let v=0; for(const f of freqs)v+=Math.sin(2*Math.PI*f*t+(f%7))*.04; out[i]=v*(.6+.4*Math.sin(2*Math.PI*3.2*t));}
  return out;
}

export const OOK_TRAIN_BITS='1111111101011010010110011000111010101010';
export function framedOokBits(bytes){ return OOK_TRAIN_BITS + bytesToBits(bytes); }

function ookTrainingScore(samples,offset,bitSamples,carrier,sampleRate){
  const powers=[];
  for(let j=0;j<OOK_TRAIN_BITS.length;j++) powers.push(goertzelPower(samples,Math.round(offset+j*bitSamples),Math.max(16,Math.round(bitSamples*.85)),carrier,sampleRate));
  const hi=powers.filter((_,i)=>OOK_TRAIN_BITS[i]==='1'); const lo=powers.filter((_,i)=>OOK_TRAIN_BITS[i]==='0');
  const hiMean=hi.reduce((a,b)=>a+b,0)/Math.max(1,hi.length); const loMean=lo.reduce((a,b)=>a+b,0)/Math.max(1,lo.length); const threshold=(hiMean+loMean)/2;
  let match=0; for(let i=0;i<powers.length;i++) if((powers[i]>threshold?'1':'0')===OOK_TRAIN_BITS[i]) match++;
  return {score:match/OOK_TRAIN_BITS.length,threshold,contrastDb:10*Math.log10((hiMean+1e-12)/(loMean+1e-12))};
}

export function decodeOokFrame(samples,{sampleRate,rawBps,carrier}){
  const bitSamples=sampleRate/rawBps, quarter=Math.max(8,Math.round(bitSamples/4));
  if(samples.length<(OOK_TRAIN_BITS.length+FIXED_FRAME_BYTES*8)*bitSamples) return {ok:false,reason:'INCOMPLETE_AUDIO'};
  const powers=[]; for(let s=0;s+bitSamples<samples.length;s+=quarter) powers.push(goertzelPower(samples,s,Math.round(bitSamples*.85),carrier,sampleRate));
  const stride=Math.max(1,Math.round(bitSamples/quarter)); let best={score:0,index:-1,threshold:0,contrastDb:0};
  for(let i=0;i+stride*(OOK_TRAIN_BITS.length-1)<powers.length;i++){
    const vals=[]; for(let j=0;j<OOK_TRAIN_BITS.length;j++) vals.push(powers[i+j*stride]);
    const hi=vals.filter((_,j)=>OOK_TRAIN_BITS[j]==='1'),lo=vals.filter((_,j)=>OOK_TRAIN_BITS[j]==='0');
    const hm=hi.reduce((a,b)=>a+b,0)/hi.length,lm=lo.reduce((a,b)=>a+b,0)/lo.length,th=(hm+lm)/2;
    let m=0;for(let j=0;j<vals.length;j++) if((vals[j]>th?'1':'0')===OOK_TRAIN_BITS[j])m++;
    const score=m/vals.length;if(score>best.score)best={score,index:i,threshold:th,contrastDb:10*Math.log10((hm+1e-12)/(lm+1e-12))};
  }
  if(best.index<0||best.score<.78) return {ok:false,reason:'PREAMBLE_MISS'};
  const coarse=best.index*quarter; let refined={offset:coarse,...ookTrainingScore(samples,coarse,bitSamples,carrier,sampleRate)};
  const span=Math.round(bitSamples/3),step=Math.max(2,Math.round(bitSamples/24));
  for(let off=Math.max(0,coarse-span);off<=coarse+span;off+=step){const t=ookTrainingScore(samples,off,bitSamples,carrier,sampleRate);if(t.score>refined.score)refined={offset:off,...t};}
  const dataStart=refined.offset+OOK_TRAIN_BITS.length*bitSamples; let bits='';
  const available=Math.floor((samples.length-dataStart)/bitSamples);
  for(let j=0;j<available;j++){
    const p=goertzelPower(samples,Math.round(dataStart+j*bitSamples),Math.max(16,Math.round(bitSamples*.85)),carrier,sampleRate);bits+=p>refined.threshold?'1':'0';
    if(bits.length>=22*8){const bytes=bitsToBytes(bits);const expected=expectedFrameLength(bytes);if(expected&&bits.length>=expected*8){const frameBytes=bitsToBytes(bits.slice(0,expected*8)).slice(0,expected);return {ok:true,frameBytes,startSample:refined.offset,endSample:Math.round(dataStart+expected*8*bitSamples),trainingScore:refined.score,snrProxyDb:refined.contrastDb};}}
  }
  return {ok:false,reason:'INCOMPLETE_AUDIO'};
}

export function synthesizeOok(bits,{sampleRate=48000,rawBps=100,carrier=18600,amplitude=.45,leadingMs=80,trailingMs=100}={}){
  const bitSamples=sampleRate/rawBps,lead=Math.round(sampleRate*leadingMs/1000),trail=Math.round(sampleRate*trailingMs/1000),n=lead+Math.ceil(bits.length*bitSamples)+trail;const out=new Float32Array(n);let phase=0,amp=0;
  for(let b=0;b<bits.length;b++){
    const st=lead+Math.round(b*bitSamples),en=lead+Math.round((b+1)*bitSamples),target=bits[b]==='1'?amplitude:.001;
    for(let i=st;i<en;i++){amp += (target-amp)*.045;out[i]=Math.sin(phase)*amp;phase+=2*Math.PI*carrier/sampleRate;if(phase>Math.PI*2)phase-=Math.PI*2;}
  }return out;
}
