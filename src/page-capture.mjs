import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {validateSourceUrl} from './public-http.mjs';
import {decodeEvidenceImage} from './image-evidence.mjs';
import {createRequire} from 'node:module';
import {isAbsolute} from 'node:path';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const policy="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

export function configuredPageCapture(env=process.env) {
  const modulePath=env.SAQ_CAPTURE_PLAYWRIGHT_PATH,browserPath=env.SAQ_CAPTURE_BROWSER_PATH;
  if(!modulePath&&!browserPath)return null;
  if(!modulePath||!browserPath||!isAbsolute(modulePath)||!isAbsolute(browserPath))throw Error('CAPTURE_BROWSER_NOT_CONFIGURED');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  return resource=>capturePublicPage(resource,{chromium,executablePath:browserPath});
}

// Render only the supplied HTML bytes. Scripts and all browser network requests stay disabled;
// the local deny proxy catches any connection that bypasses the route guard.
export async function capturePublicPage(resource,{chromium,executablePath,timeoutMs=25000,settleMs=1000,maxRequests=40,maxTotalBytes=16*1024*1024}={}) {
  const url=validateSourceUrl(resource.finalUrl).href;
  if(!['text/html','application/xhtml+xml'].includes(resource.mime)||!Buffer.isBuffer(resource.bytes)||resource.bytes.length>2*1024*1024)throw Error('CAPTURE_INVALID_HTML');
  if(!chromium?.launch||typeof executablePath!=='string'||!executablePath)throw Error('CAPTURE_BROWSER_NOT_CONFIGURED');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000||!Number.isInteger(settleMs)||settleMs<0||settleMs>5000||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>100||!Number.isInteger(maxTotalBytes)||maxTotalBytes<resource.bytes.length||maxTotalBytes>32*1024*1024)throw Error('CAPTURE_INVALID_LIMITS');
  const startedAt=new Date().toISOString(),assets=[],blocked={nonGet:0,networkDisabled:0,navigation:0,budget:0,failed:0,proxyFallback:0};
  const deny=createServer((_request,response)=>{blocked.proxyFallback++;response.writeHead(403);response.end();});
  deny.on('connect',(_request,socket)=>{blocked.proxyFallback++;socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
  deny.on('clientError',(_error,socket)=>socket.destroy());
  let browser,context,page,timer,expired=false,rootServed=false,requests=0,totalBytes=resource.bytes.length;
  const pending=new Set();
  try {
    await new Promise((resolve,reject)=>{deny.once('error',reject);deny.listen(0,'127.0.0.1',resolve);});
    const work=async()=>{
      browser=await chromium.launch({headless:true,executablePath,chromiumSandbox:true,proxy:{server:'http://127.0.0.1:'+deny.address().port},args:['--proxy-bypass-list=<-loopback>','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking']});
      if(expired){await browser.close();throw Error('CAPTURE_TIMEOUT');}
      context=await browser.newContext({viewport:{width:1280,height:960},deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false,permissions:[],reducedMotion:'reduce'});
      await context.route('**/*',async route=>{
        const task=(async()=>{
          const request=route.request();
          try {
            if(expired)return await route.abort();
            if(request.method()!=='GET'){blocked.nonGet++;return await route.abort();}
            if(request.isNavigationRequest()) {
              if(!rootServed&&request.url()===url){rootServed=true;return await route.fulfill({status:200,contentType:resource.mime+'; charset=utf-8',body:resource.bytes,headers:{'Content-Security-Policy':policy,'X-Content-Type-Options':'nosniff'}});}
              blocked.navigation++;return await route.abort();
            }
            if(++requests>maxRequests){blocked.budget++;return await route.abort();}
            blocked.networkDisabled++;return await route.abort();
          }catch{blocked.failed++;await route.abort().catch(()=>{});}
        })();pending.add(task);try{await task;}finally{pending.delete(task);}
      });
      page=await context.newPage();context.on('page',popup=>{if(popup!==page){blocked.navigation++;popup.close().catch(()=>{});}});
      page.on('pageerror',()=>{blocked.failed++;});page.on('requestfailed',()=>{blocked.failed++;});
      page.on('console',message=>{if(message.type()==='error')blocked.failed++;});
      page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
      await page.goto(url,{waitUntil:'load',timeout:timeoutMs});
      if(settleMs)await page.waitForTimeout(settleMs);
      if(pending.size)await Promise.allSettled([...pending]);
      if(expired||!rootServed)throw Error('CAPTURE_TIMEOUT');
      const documentSize=await page.evaluate(()=>({
        width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth??0),
        height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0)
      }));
      const documentWidth=Number.isFinite(documentSize?.width)?documentSize.width:1280;
      const documentHeight=Number.isFinite(documentSize?.height)?documentSize.height:960;
      // Keep a full-page image within the evidence decoder's 16 MP limit. Oversized or
      // horizontally clipped pages still get a truthful viewport capture marked PARTIAL.
      const fullPage=documentWidth<=1280&&documentHeight<=12500;
      let jpeg,viewportOnly=!fullPage;
      try {
        jpeg=await page.screenshot({type:'jpeg',quality:65,fullPage,animations:'disabled',timeout:5000});
      } catch(error) {
        if(!fullPage)throw error;
        viewportOnly=true;
        jpeg=await page.screenshot({type:'jpeg',quality:75,fullPage:false,animations:'disabled',timeout:5000});
      }
      if(viewportOnly||!Buffer.isBuffer(jpeg)||jpeg.length>700*1024) {
        if(!viewportOnly)jpeg=await page.screenshot({type:'jpeg',quality:55,fullPage:true,animations:'disabled',timeout:5000}).catch(()=>null);
        if(!Buffer.isBuffer(jpeg)||jpeg.length>700*1024) {
          jpeg=await page.screenshot({type:'jpeg',quality:75,fullPage:false,animations:'disabled',timeout:5000});
          viewportOnly=true;
          if(!Buffer.isBuffer(jpeg)||jpeg.length>700*1024)jpeg=await page.screenshot({type:'jpeg',quality:55,fullPage:false,animations:'disabled',timeout:5000});
        }
      }
      const decoded=decodeEvidenceImage(jpeg.toString('base64'));
      if(decoded.width>1280||decoded.height>12500||decoded.width*decoded.height>16_000_000||(viewportOnly&&(decoded.width!==1280||decoded.height!==960))||(!viewportOnly&&(decoded.width!==1280||decoded.height!==Math.ceil(documentHeight))))throw Error('CAPTURE_INVALID_DIMENSIONS');
      return {...decoded,capturedAt:new Date().toISOString(),provenance:{version:1,method:viewportOnly?'CONTROLLED_BROWSER_VIEWPORT':'CONTROLLED_BROWSER_FULL_PAGE',startedAt,rootOrigin:new URL(url).origin,rootSha256:digest(resource.bytes),viewport:{width:1280,height:960},documentWidth,documentHeight,viewportOnly,assets,blocked,resourceBytes:totalBytes,partial:viewportOnly||documentWidth>1280||documentHeight>12500||Object.entries(blocked).some(([key,count])=>key!=='proxyFallback'&&count>0)}};
    };
    return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;browser?.close().catch(()=>{});reject(Error('CAPTURE_TIMEOUT'));},timeoutMs);})]);
  }finally {
    clearTimeout(timer);expired=true;await context?.close().catch(()=>{});await browser?.close().catch(()=>{});deny.closeAllConnections();await new Promise(resolve=>deny.close(resolve));
  }
}
