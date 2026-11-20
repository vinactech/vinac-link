class VinacRxProcessor extends AudioWorkletProcessor {
  constructor(){super();this.buf=new Float32Array(2048);this.pos=0;}
  process(inputs){
    const input=inputs[0]?.[0]; if(!input)return true;
    let src=0;
    while(src<input.length){const n=Math.min(input.length-src,this.buf.length-this.pos);this.buf.set(input.subarray(src,src+n),this.pos);this.pos+=n;src+=n;if(this.pos===this.buf.length){const payload=this.buf;this.port.postMessage({type:'pcm',pcm:payload},[payload.buffer]);this.buf=new Float32Array(2048);this.pos=0;}}
    return true;
  }
}
registerProcessor('vinac-rx-processor',VinacRxProcessor);
