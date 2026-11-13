import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {handleGateRequest} from '../functions/_utils/gate.js';
const code=fs.readFileSync(new URL('../public/wiki.js',import.meta.url),'utf8');
async function testWikiSession(result){
 const root={innerHTML:'',addEventListener(){},querySelector(){return {addEventListener(){}}}};
 let reloads=0;
 const sandbox={
  document:{querySelector:()=>root,addEventListener(){}},
  window:{addEventListener(){}},
  location:{hash:'',reload(){reloads++},assign(){}},
  fetch:async()=>result,
  console, URL, crypto:globalThis.crypto, setTimeout,clearTimeout,
 };
 vm.runInNewContext(code,sandbox,{filename:'wiki.js'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(reloads,0,'Wiki must never force reload on auth problems');
 assert.match(root.innerHTML,/확인 필요/);
 return root.innerHTML;
}
await testWikiSession({ok:true,status:200,json:async()=>({member:null,mediaReady:false})});
await testWikiSession({ok:false,status:401,json:async()=>({error:'입장 인증이 필요합니다.'})});

// Exercise the *actual* login-page JS: if a browser refuses to persist the cookie,
// login must show a stable error instead of refreshing into a loop.
const env={WIKI_SESSION_SECRET:'random-signing-secret-at-least-32-chars',PIA_ACCESS_PASSWORD:'a-long-shared-pass'};
const res=await handleGateRequest(new Request('https://example.test/',{headers:{accept:'text/html'}}),env,async()=>new Response('unreachable'));
const html=await res.text();
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
let onSubmit, replaceCount=0, reloadCount=0, displayedError='';
const button={disabled:false};
const form={addEventListener(_type,fn){onSubmit=fn},before(p){displayedError=p.textContent}};
const elems={gateForm:form,submit:button,password:{value:'a-long-shared-pass'},remember:{checked:true}};
const browser={
 document:{
  getElementById:id=>elems[id],
  querySelector:()=>null,
  createElement:()=>({className:'',setAttribute(){},set textContent(v){this._text=v},get textContent(){return this._text}}),
 },
 fetch:async path=>path==='/api/gate/login'?{ok:true,json:async()=>({ok:true})}:{ok:false,status:401},
 location:{replace(){replaceCount++},reload(){reloadCount++}},
 Error,
};
vm.runInNewContext(script,browser,{filename:'gate-login.js'});
await onSubmit({preventDefault(){}});
assert.equal(replaceCount,0);
assert.equal(reloadCount,0);
assert.match(displayedError,/로그인 상태가 유지되지 않습니다/);
assert.equal(button.disabled,false);
console.log('PASS: no auto-reload on missing wiki session/401; login checks cookie before navigation.');
