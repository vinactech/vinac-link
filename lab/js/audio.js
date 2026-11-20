import { framedFskSymbols, framedFskSymbolsV2, framedOokBits, toneSetForSampleRate } from './modem.js';

export class AudioEngine {
  constructor({onPcm=()=>{},onState=()=>{}}={}){this.onPcm=onPcm;this.onState=onState;this.context=null;this.txNode=null;this.rxNode=null;this.stream=null;this.source=null;this.analyser=null;this.trackSettings={};}
  async ensureContext(){
    // Calls that overlap share one start-up, so nobody gets a context whose worklets are still loading.
    if(!this.contextReady){this.contextReady=(async()=>{this.context=new AudioContext({latencyHint:'interactive'});await this.context.audioWorklet.addModule(new URL('../worklets/vinac-tx-processor.js',import.meta.url));await this.context.audioWorklet.addModule(new URL('../worklets/vinac-rx-processor.js',import.meta.url));})().catch(e=>{this.contextReady=null;this.context=null;throw e;});}
    await this.contextReady;
    if(this.context.state==='suspended')await this.context.resume(); return this.context;
  }
  async ensureTx(){const ctx=await this.ensureContext();if(!this.txNode){this.txNode=new AudioWorkletNode(ctx,'vinac-tx-processor',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});this.txNode.connect(ctx.destination);}return this.txNode;}
  async startReceiver(){
    const ctx=await this.ensureContext(); if(this.stream)return this.trackSettings;
    this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
    const track=this.stream.getAudioTracks()[0];this.trackSettings=track?.getSettings?.()||{};
    this.source=ctx.createMediaStreamSource(this.stream);this.analyser=ctx.createAnalyser();this.analyser.fftSize=4096;this.analyser.smoothingTimeConstant=.18;this.source.connect(this.analyser);
    this.rxNode=new AudioWorkletNode(ctx,'vinac-rx-processor',{numberOfInputs:1,numberOfOutputs:0});this.rxNode.port.onmessage=e=>{if(e.data?.type==='pcm')this.onPcm(new Float32Array(e.data.pcm));};this.source.connect(this.rxNode);this.onState({receiver:true,sampleRate:ctx.sampleRate,trackSettings:this.trackSettings});return this.trackSettings;
  }
  stopReceiver(){try{this.source?.disconnect()}catch{}try{this.rxNode?.disconnect()}catch{}this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.source=null;this.rxNode=null;this.analyser=null;this.onState({receiver:false});}
  async playFrame(frameBytes,{modulation='fsk4',rawBps=100,tones=null,amplitude=.28,fec=false}={}){
    const tx=await this.ensureTx();const sampleRate=this.context.sampleRate;tones=tones||toneSetForSampleRate(sampleRate);const symbols=modulation==='fsk4'?(fec?framedFskSymbolsV2(frameBytes,typeof fec==='number'?fec:32):framedFskSymbols(frameBytes)):[...framedOokBits(frameBytes)].map(x=>x==='1'?1:0);
    const durationMs=(modulation==='fsk4'?symbols.length/(rawBps/2):symbols.length/rawBps)*1000;
    return new Promise(resolve=>{const handler=e=>{if(e.data?.type==='done'){tx.port.removeEventListener('message',handler);resolve({durationMs,sampleRate,tones,symbols});}};tx.port.addEventListener('message',handler);tx.port.start();tx.port.postMessage({type:'play',modulation,rawBps,tones,carrier:tones[2],amplitude,symbols});});
  }
  async playTone(frequency,durationMs=500,amplitude=.12){const tx=await this.ensureTx();return new Promise(resolve=>{const h=e=>{if(e.data?.type==='done'){tx.port.removeEventListener('message',h);resolve();}};tx.port.addEventListener('message',h);tx.port.start();tx.port.postMessage({type:'tone',frequency,durationMs,amplitude});});}
  stopTx(){this.txNode?.port.postMessage({type:'stop'});}
  readSpectrum(){if(!this.analyser||!this.context)return null;const data=new Float32Array(this.analyser.frequencyBinCount);this.analyser.getFloatFrequencyData(data);return {data,sampleRate:this.context.sampleRate,fftSize:this.analyser.fftSize};}
  get sampleRate(){return this.context?.sampleRate||null;}
}
