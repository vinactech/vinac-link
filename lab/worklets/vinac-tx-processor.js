class VinacTxProcessor extends AudioWorkletProcessor {
  constructor(){
    super(); this.job=null; this.sampleIndex=0; this.phase=0; this.amp=0;
    this.port.onmessage=e=>this.handle(e.data||{});
  }
  handle(m){
    if(m.type==='stop'){this.job=null;this.amp=0;return;}
    if(m.type==='play'){
      this.job={...m,symbolSamples:m.modulation==='fsk4'?sampleRate/(m.rawBps/2):sampleRate/m.rawBps};
      this.sampleIndex=0; this.phase=0; this.amp=0;
    }
    if(m.type==='tone'){
      this.job={type:'tone',frequency:m.frequency,durationSamples:Math.round(sampleRate*m.durationMs/1000),amplitude:m.amplitude??.15};this.sampleIndex=0;this.phase=0;this.amp=0;
    }
  }
  process(inputs,outputs){
    const out=outputs[0]?.[0]; if(!out) return true;
    out.fill(0); const job=this.job; if(!job)return true;
    for(let i=0;i<out.length;i++){
      if(job.type==='tone'){
        if(this.sampleIndex>=job.durationSamples){this.job=null;this.amp=0;this.port.postMessage({type:'done'});break;}
        const fade=Math.max(1,Math.round(sampleRate*.008)); let env=1;if(this.sampleIndex<fade)env=this.sampleIndex/fade;if(job.durationSamples-this.sampleIndex<fade)env=Math.min(env,(job.durationSamples-this.sampleIndex)/fade);
        out[i]=Math.sin(this.phase)*job.amplitude*Math.max(0,env);this.phase+=2*Math.PI*job.frequency/sampleRate;this.sampleIndex++;continue;
      }
      const symbols=job.symbols||[]; const total=Math.ceil(symbols.length*job.symbolSamples);
      if(this.sampleIndex>=total){this.job=null;this.amp=0;this.port.postMessage({type:'done'});break;}
      const si=Math.min(symbols.length-1,Math.floor(this.sampleIndex/job.symbolSamples));
      let freq, target;
      if(job.modulation==='fsk4'){freq=job.tones[symbols[si]&3];target=job.amplitude??.28;}
      else {freq=job.carrier;target=symbols[si]?job.amplitude??.28:.0005;}
      this.amp += (target-this.amp)*(job.modulation==='ook'?.05:.018);
      const fade=Math.max(1,Math.round(sampleRate*.008));let env=1;if(this.sampleIndex<fade)env=this.sampleIndex/fade;if(total-this.sampleIndex<fade)env=Math.min(env,(total-this.sampleIndex)/fade);
      out[i]=Math.sin(this.phase)*this.amp*Math.max(0,env);
      this.phase+=2*Math.PI*freq/sampleRate;if(this.phase>Math.PI*2)this.phase-=Math.PI*2;this.sampleIndex++;
    }
    return true;
  }
}
registerProcessor('vinac-tx-processor',VinacTxProcessor);
