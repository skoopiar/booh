const $=id=>document.getElementById(id);
function knightDebug(level,message){
 const out=document.getElementById('knight-debug-output'),panel=document.getElementById('knight-debug-panel');
 const line='['+level+'] '+message;
 if(out){const row=document.createElement('div');row.textContent=line;out.appendChild(row);while(out.childNodes.length>160)out.removeChild(out.firstChild);}
 if(panel)panel.scrollTop=panel.scrollHeight;
 console[level==='ERROR'?'error':level==='WARN'?'warn':'log']('[KNIGHT ACTIVITY]',message);
}
window.addEventListener('error',e=>knightDebug('ERROR','Window error: '+(e.message||e.error||'unknown')));
window.addEventListener('unhandledrejection',e=>knightDebug('ERROR','Unhandled promise: '+(e.reason?.stack||e.reason||'unknown')));
/* Activity-wide debug console uses markup in index.html, outside the game iframe. */
(function installActivityDebugConsole() {
 const panel=document.getElementById('knight-debug-panel'),output=document.getElementById('knight-debug-output');
 if(!panel||!output)return;
 function append(level,message){const line=document.createElement('div');line.textContent='['+level+'] '+message;if(level==='ERROR')line.style.color='#ff9b9b';else if(level==='WARN')line.style.color='#ffe39b';output.appendChild(line);while(output.childNodes.length>160)output.removeChild(output.firstChild);panel.scrollTop=panel.scrollHeight;}
 const hide=document.getElementById('knight-debug-hide'),reopen=document.getElementById('knight-debug-show');
 hide.addEventListener('click',()=>{panel.hidden=true;reopen.hidden=false;});
 reopen.addEventListener('click',()=>{panel.hidden=false;reopen.hidden=true;});
 window.addEventListener('message',event=>{if(event.data?.type==='KNIGHT_DEBUG_LOG')append(event.data.level||'LOG',String(event.data.message||''));});
 append('INFO','Activity debug console installed');
})();
let currentRoute='normal',gameURL=null,loadingPromise=null,session=0,timeout;
const isRoute=v=>v==='normal'||v==='weird';
function status(text,value){$('load-label').textContent=text;if(value!==undefined)$('progress').value=value;if(value===undefined||value===0||value===100||Math.round(value)%10===0)knightDebug('LOAD',text);}
function screen(id){for(const name of ['title-screen','loading','game-host','result','error'])$(name).hidden=name!==id;}
async function loadGame(){
 knightDebug('LOAD','loadGame called');
 if(gameURL){knightDebug('LOAD','Reusing existing game Blob URL');return gameURL;}
 if(loadingPromise)return loadingPromise;
 loadingPromise=(async()=>{
  knightDebug('LOAD','Fetching runtime/game-manifest.json');
  const meta=await fetch('runtime/game-manifest.json');knightDebug('LOAD','Manifest response: HTTP '+meta.status);if(!meta.ok)throw new Error('Game files are missing. Run the local build step described in the README.');
  const {parts,totalBytes}=await meta.json();knightDebug('LOAD','Manifest parsed: '+parts.length+' parts, '+totalBytes+' bytes');let received=0;const buffers=[];
  for(const part of parts){
   knightDebug('LOAD','Fetching '+part);
   const response=await fetch('runtime/'+part);knightDebug('LOAD',part+' response: HTTP '+response.status);if(!response.ok)throw new Error('A game download failed. Check your connection and try again.');
   const chunks=[];const reader=response.body.getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;status('Loading the Knight… '+Math.round(received/totalBytes*100)+'%',received/totalBytes*100);}
   knightDebug('LOAD',part+' downloaded; total '+received+'/'+totalBytes+' bytes');
   buffers.push(new Blob(chunks));
  }
  knightDebug('LOAD','All parts downloaded; creating Blob URL');
  gameURL=URL.createObjectURL(new Blob(buffers,{type:'application/octet-stream'}));knightDebug('LOAD','Blob URL created');return gameURL;
 })().catch(e=>{knightDebug('ERROR','Game download failed: '+(e.stack||e));loadingPromise=null;throw e;});
 return loadingPromise;
}
function fail(message){knightDebug('ERROR','Activity failure: '+message);clearTimeout(timeout);$('error-text').textContent=message;screen('error');$('game-host').replaceChildren();}
async function start(route=currentRoute){
 if(!isRoute(route))throw new Error('Unknown route');currentRoute=route;const run=++session;knightDebug('INFO','Starting route: '+route);
 clearTimeout(timeout);$('game-host').replaceChildren();document.body.classList.add('playing');screen('loading');status('Preparing the Knight…',0);
 $('route-name').textContent=route==='weird'?'WEIRD ROUTE':'NORMAL ROUTE';$('menu').hidden=false;$('retry').hidden=true;
 try{
  await loadGame();knightDebug('LOAD','loadGame completed');if(run!==session)return;
  status('Entering the arena…',100);
  knightDebug('LOAD','Creating game iframe');
  const frame=document.createElement('iframe');frame.addEventListener('load',()=>knightDebug('LOAD','Game iframe load event fired'));frame.addEventListener('error',()=>knightDebug('ERROR','Game iframe error event'));frame.title='Kaizo Roaring Knight — '+route+' route';frame.allow='autoplay; fullscreen; gamepad';frame.src='runtime/?route='+route;frame.id='game-frame';$('game-host').append(frame);
  knightDebug('LOAD','Iframe appended; waiting for KNIGHT_READY');
  timeout=setTimeout(()=>{if(run===session){knightDebug('ERROR','90-second startup timeout reached');fail('The game took too long to start. Try again, or use a current desktop Chrome or Edge browser.');}},90000);
 }catch(error){if(run===session)fail(error.message);}
}
function menu(){session++;clearTimeout(timeout);$('game-host').replaceChildren();screen('title-screen');document.body.classList.remove('playing');$('route-name').textContent='';$('retry').hidden=true;$('menu').hidden=true;document.querySelector('[data-route="'+currentRoute+'"]').focus();}
window.knightHost={getGameURL:()=>gameURL,ready(){knightDebug('INFO','Game signalled KNIGHT_READY');clearTimeout(timeout);screen('game-host');$('retry').hidden=false;$('game-frame')?.contentWindow.focus();},result(value){clearTimeout(timeout);$('game-host').hidden=false;$('result').hidden=false;$('result-title').textContent=value==='VICTORY'?'THE KNIGHT FALLS.':'THE FIGHT IS NOT OVER.';},error:fail,retry:()=>start(),menu};
for(const button of document.querySelectorAll('[data-route]'))button.addEventListener('click',()=>{
 const route=button.dataset.route;
 const out=document.getElementById('knight-debug-output'),panel=document.getElementById('knight-debug-panel');
 const line=document.createElement('div');line.textContent='[CLICK] Route button clicked: '+route+' at '+new Date().toLocaleTimeString();
 if(out){out.appendChild(line);while(out.childNodes.length>160)out.removeChild(out.firstChild);}
 if(panel)panel.scrollTop=panel.scrollHeight;
 start(route);
});
$('menu').onclick=menu;$('retry').onclick=()=>start();$('again').onclick=()=>start();$('choose').onclick=menu;$('try-again').onclick=()=>start();$('error-menu').onclick=menu;
$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('stage').requestFullscreen().catch(()=>{});};
document.addEventListener('keydown',event=>{if(event.code==='KeyR'&&$('title-screen').hidden){event.preventDefault();start();}else if(event.code==='Escape'&&$('title-screen').hidden){menu();}});
if(navigator.modelContext?.registerTool){
 navigator.modelContext.registerTool({name:'start_knight_fight',description:'Start the Kaizo Knight battle in the selected route.',inputSchema:{type:'object',properties:{route:{type:'string',enum:['normal','weird']}},required:['route']},execute:async({route})=>{await start(route);return {content:[{type:'text',text:'Starting '+route+' route.'}]};}});
 navigator.modelContext.registerTool({name:'return_to_routes',description:'End this attempt and return to route selection.',inputSchema:{type:'object',properties:{}},execute:async()=>{menu();return {content:[{type:'text',text:'Route selection opened.'}]};}});
}
