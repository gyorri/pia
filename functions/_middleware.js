import {handleGateRequest} from './_utils/gate.js';
import {handleWiki} from './_utils/wiki.js';

// Keep the site gate and wiki API within the SAME authenticated request.
// Passing the trusted gate role avoids a second, potentially inconsistent
// cookie read after Pages Functions routing via next().
export const onRequest = ({request,env,next}) => handleGateRequest(request,env,(gateRole)=>{
 const pathname=new URL(request.url).pathname;
 if(pathname==='/api/wiki'||pathname.startsWith('/api/wiki/')){
  const route=pathname==='/api/wiki'?'':pathname.slice('/api/wiki/'.length);
  return handleWiki(request,env,route,gateRole);
 }
 return next();
});
