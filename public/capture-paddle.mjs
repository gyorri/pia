/* PIA v0.3.34 — optional, lazy-loaded PaddleOCR.js Korean PP-OCRv5 trial.
 * Client-side inference. No PIA backend writes or paid OCR API.
 * Third-party SDK, ONNX/WASM resources and public model files are downloaded
 * only after an explicit click. Real-world CDN/model compatibility must be
 * validated in the user's browser; Tesseract.js remains the default OCR. */
const CDN_SOURCES=[
 'https://esm.sh/@paddleocr/paddleocr-js@0.4.2?bundle',
 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm'
];
let enginePromise=null;
function linePosition(poly){
 const pts=Array.isArray(poly)?poly:[];
 const coords=pts.flatMap(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))?[[Number(p[0]),Number(p[1])]]:[]);
 return coords.length?{x:Math.min(...coords.map(p=>p[0])),y:Math.min(...coords.map(p=>p[1]))}:{x:Infinity,y:Infinity};
}
export function normalizePaddleResult(result){
 const items=Array.isArray(result?.items)?result.items:[];
 const lines=items.map((item,index)=>{
  const text=String(item?.text??'').trim();
  const coord=linePosition(item?.poly);
  const score=Number(item?.score);
  return {text,index,x:coord.x,y:coord.y,score:Number.isFinite(score)&&score>=0&&score<=1?score:null};
 }).filter(line=>line.text);
 // Preserve source order for absent coordinates. On screens with multiple posts,
 // line geometry yields the reading sequence; it does NOT identify posts itself.
 lines.sort((a,b)=>Number.isFinite(a.y)&&Number.isFinite(b.y)?(Math.abs(a.y-b.y)>10?a.y-b.y:a.x-b.x):a.index-b.index);
 const scored=lines.filter(l=>l.score!==null);
 return {
  text:lines.map(line=>line.text).join('\n'),
  count:lines.length,
  meanScore:scored.length?scored.reduce((a,b)=>a+b.score,0)/scored.length:null,
  metrics:result?.metrics&&typeof result.metrics==='object'?{
   detMs:Number(result.metrics.detMs)||0,
   recMs:Number(result.metrics.recMs)||0,
   totalMs:Number(result.metrics.totalMs)||0,
   detectedBoxes:Number(result.metrics.detectedBoxes)||0,
   recognizedCount:Number(result.metrics.recognizedCount)||0
  }:null
 };
}
async function importSdk(){
 const failures=[];
 for(const url of CDN_SOURCES){
  try{
   const sdk=await import(/* webpackIgnore: true */ url);
   const constructor=sdk?.PaddleOCR||sdk?.default?.PaddleOCR;
   if(typeof constructor?.create!=='function')throw Error('PaddleOCR.create 진입점을 찾지 못했습니다.');
   return constructor;
  }catch(e){failures.push(`${new URL(url).hostname}: ${String(e?.message||e).slice(0,140)}`)}
 }
 throw Error('무료 PaddleOCR.js 모듈 다운로드에 실패했습니다. '+failures.join(' / '));
}
export function resetPaddleEngineForTests(){enginePromise=null}
async function getEngine(report,inject){
 if(!enginePromise){
  enginePromise=(async()=>{
   report('PaddleOCR.js 무료 SDK를 브라우저에 불러오는 중…');
   const PaddleOCR=inject||await importSdk();
   report('한국어 PP-OCRv5 모델 및 ONNX 실행 엔진 준비 중… (첫 실행은 오래 걸릴 수 있음)');
   return PaddleOCR.create({
    lang:'korean',ocrVersion:'PP-OCRv5',
    textDetectionModelName:'PP-OCRv5_mobile_det',
    textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',
    textDetectionBatchSize:1,textRecognitionBatchSize:4,
    ortOptions:{backend:'wasm',numThreads:1,simd:true}
   });
  })().catch(e=>{enginePromise=null;throw e});
 }
 return enginePromise;
}
export async function runPaddleOCR(file,onProgress=()=>{},{sdkConstructor}={}){
 if(!file||!(file instanceof Blob))throw Error('PNG·JPG·WEBP 원본 이미지를 먼저 넣어 주세요.');
 const report=typeof onProgress==='function'?onProgress:()=>{};
 const engine=await getEngine(report,sdkConstructor);
 report('PaddleOCR 한국어 텍스트 검출 및 인식 중…');
 const predictions=await engine.predict(file);
 if(!Array.isArray(predictions)||!predictions.length)throw Error('인식 엔진에서 이미지 결과를 받지 못했습니다.');
 const value=normalizePaddleResult(predictions[0]);
 report('PaddleOCR 인식 완료.');
 return value;
}
