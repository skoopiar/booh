/* =========================================
   GameMaker callbacks
========================================= */

var g_pWadLoadCallback;
var g_pJSExceptionHandler;
var g_pAddAsyncMethod = -1;

function setWadLoadCallback(fn) {
    g_pWadLoadCallback = fn;
}

function setAddAsyncMethod(fn) {
    g_pAddAsyncMethod = fn;
}

function setJSExceptionHandler(fn) {
    g_pJSExceptionHandler = fn;
}

function hasJSExceptionHandler() {
    return typeof g_pJSExceptionHandler === 'function';
}

function doJSExceptionHandler(s) {
    if (hasJSExceptionHandler()) {
        g_pJSExceptionHandler(JSON.parse(s));
    }
}

function manifestFiles() {
    return 'game.unx;';
}

function manifestFilesMD5() {
    return ';';
}

function onFirstFrameRendered() {
    console.log('FIRST FRAME');
}

function onGameSetWindowSize(w, h) {
    console.log('WINDOW SIZE', w, h);
}

function ModuleName() {
    return Module;
}


/* =========================================
   Discord Activity bridge
========================================= */

/* Forward runtime logs to the parent Activity, where they can sit above loading UI. */
(function forwardActivityLogs() {
    function format(value) {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    for (const level of ['log', 'warn', 'error']) {
        const native = console[level].bind(console);
        console[level] = (...args) => {
            native(...args);
            try {
                window.parent.postMessage({
                    type: 'KNIGHT_DEBUG_LOG',
                    level: level.toUpperCase(),
                    message: Array.from(args, format).join(' ')
                }, '*');
            } catch (_) {}
        };
    }
})();

const host = window.parent !== window
    ? window.parent.knightHost
    : null;

console.log('[DEBUG] Bridge loaded');
console.log('[DEBUG] Has host:', !!host);
console.log(
    '[DEBUG] Has game URL:',
    !!host?.getGameURL?.()
);

/* Trace every canvas getContext call — stall after prepare_cache is often WebGL. */
(function instrumentGetContext() {
    const proto = HTMLCanvasElement.prototype;
    const native = proto.getContext;
    proto.getContext = function(type, attrs) {
        const rect = this.getBoundingClientRect();
        console.log('[WEBGL TRACE] getContext', type, {
            attrs: attrs || null,
            canvas: this.id || '(no id)',
            buffer: this.width + 'x' + this.height,
            layout: Math.round(rect.width) + 'x' + Math.round(rect.height),
            hidden: !this.isConnected || rect.width === 0 || rect.height === 0
        });
        let ctx = null;
        try {
            ctx = native.call(this, type, attrs);
        } catch (err) {
            console.error('[WEBGL TRACE] getContext threw', type, err && (err.stack || err.message || err));
            throw err;
        }
        if (!ctx) {
            console.error('[WEBGL TRACE] getContext returned null for', type);
            // One retry with relaxed attrs for Discord Activity iframes
            if (String(type).indexOf('webgl') !== -1) {
                try {
                    ctx = native.call(this, type, {
                        alpha: true,
                        depth: true,
                        stencil: true,
                        antialias: false,
                        premultipliedAlpha: true,
                        preserveDrawingBuffer: false,
                        powerPreference: 'default',
                        failIfMajorPerformanceCaveat: false
                    });
                    console.log('[WEBGL TRACE] retry result', !!ctx);
                } catch (err2) {
                    console.error('[WEBGL TRACE] retry threw', err2 && (err2.message || err2));
                }
            }
        } else {
            try {
                console.log('[WEBGL TRACE] context ok', type, ctx.getParameter(ctx.VERSION));
            } catch (_) {
                console.log('[WEBGL TRACE] context ok', type);
            }
        }
        return ctx;
    };
})();


/* =========================================
   XHR request interception
========================================= */

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
let xhrSequence = 0;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__knightTrace = { id: ++xhrSequence, method, url: String(url), started: performance.now() };
    console.log('[NET TRACE] XHR #'+this.__knightTrace.id+' open', method, String(url));
    if (typeof url === 'string' && /(^|\/)game\.unx(?:\?|$)/.test(url) && host?.getGameURL?.()) {
        console.log('[NET TRACE] Redirecting game.unx to parent Blob URL');
        url = host.getGameURL();
        this.__knightTrace.url = '[parent Blob URL]';
    }
    return nativeOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function(body) {
    const t=this.__knightTrace;
    if(t) {
        console.log('[NET TRACE] XHR #'+t.id+' send; bodyBytes='+(body?.byteLength ?? body?.size ?? (typeof body==='string'?body.length:0)));
        for(const name of ['load','error','abort','timeout','loadend']) this.addEventListener(name,()=>{
            if(name==='loadend') console.log('[NET TRACE] XHR #'+t.id+' complete', {url:t.url,status:this.status,statusText:this.statusText,readyState:this.readyState,responseType:this.response?.byteLength ?? this.response?.size ?? null,durationMs:Math.round(performance.now()-t.started)});
            else if(name!=='load') console.error('[NET TRACE] XHR #'+t.id+' '+name,{url:t.url,status:this.status,readyState:this.readyState,durationMs:Math.round(performance.now()-t.started)});
        });
        this.addEventListener('progress',e=>{if(e.lengthComputable)console.log('[NET TRACE] XHR #'+t.id+' progress',e.loaded+'/'+e.total);});
    }
    return nativeSend.call(this, body);
};


/* =========================================
   Fetch request interception (redirect game.unx)
========================================= */

const nativeFetch = window.fetch;

window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : input?.url ?? String(input);
    const started = performance.now();

    if (typeof url === 'string' && /(^|\/)game\.unx(?:\?|$)/.test(url) && host?.getGameURL?.()) {
        console.log('[NET TRACE] FETCH redirecting game.unx to parent Blob URL');
        url = host.getGameURL();
        input = url;
    }

    if (window.__knightGameBuffer && typeof url === 'string' &&
        (url.indexOf('blob:') === 0 || /(^|\/)game\.unx(?:\?|$)/.test(url))) {
        console.log('[NET TRACE] FETCH serving cached game buffer, bytes=' + window.__knightGameBuffer.byteLength);
        return Promise.resolve(new Response(window.__knightGameBuffer.slice(0), {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/octet-stream' }
        }));
    }

    console.log('[NET TRACE] FETCH start', url);
    return nativeFetch.call(this, input, init).then(response => {
        console.log('[NET TRACE] FETCH response', {url, status: response.status, type: response.type, durationMs: Math.round(performance.now() - started)});
        return response;
    }, error => {
        console.error('[NET TRACE] FETCH failed', {url, error: String(error), durationMs: Math.round(performance.now() - started)});
        throw error;
    });
};


/* =========================================
   GameMaker console output
========================================= */

function gameLog(...args) {
    console.log('[DEBUG] GAME LOG:', ...args);

    const line = args.join(' ');

    if (line.startsWith('KNIGHT_READY:')) {
        host?.ready();
    }

    if (line.startsWith('KNIGHT_RESULT:')) {
        host?.result(line.split(':')[1]);
    }

    if (
        line.includes('ERROR!!!') ||
        line.includes('FATAL ERROR')
    ) {
        host?.error(
            'The game encountered a runtime error. Retry the fight.'
        );
    }
}


/* =========================================
   GameMaker module configuration
========================================= */

var Module = {
    canvas: document.getElementById('canvas'),

    noExitRuntime: true,

    preRun: [
        function() {
            console.log('[BOOT TRACE] preRun entered');
            try {
                Module.FS_createPath('/', 'assets', true, true);
                Module.FS_createDataFile('/assets','browser-route.txt',
                    new URLSearchParams(location.search).get('route') === 'weird' ? '1' : '0',true,true);
                console.log('[BOOT TRACE] preRun filesystem setup complete');
            } catch(error) {
                console.error('[BOOT TRACE] preRun filesystem setup failed',error?.stack||error);
                throw error;
            }

            const gameUrl = host?.getGameURL?.();
            if (gameUrl) {
                console.log('[BOOT TRACE] scheduling game.unx load from parent Blob');
                Module.addRunDependency('game-unx');
                fetch(gameUrl)
                    .then(function(res) {
                        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching game Blob');
                        return res.arrayBuffer();
                    })
                    .then(function(buf) {
                        window.__knightGameBuffer = buf;
                        console.log('[BOOT TRACE] cached game buffer on window, bytes=' + buf.byteLength);
                        try {
                            try { Module.FS_unlink('/game.unx'); } catch (_) {}
                            Module.FS_createDataFile('/', 'game.unx', new Uint8Array(buf), true, true, true);
                            console.log('[BOOT TRACE] game.unx mounted in FS, bytes=' + buf.byteLength);
                        } catch (err) {
                            console.error('[BOOT TRACE] FS mount failed (buffer still cached for async path)', err?.stack || err);
                        }
                    })
                    .catch(function(err) {
                        console.error('[BOOT TRACE] failed to load game data', err?.stack || err);
                    })
                    .finally(function() {
                        Module.removeRunDependency('game-unx');
                    });
            } else {
                console.warn('[BOOT TRACE] no parent game URL');
            }
        }
    ],

    postRun: [function(){
        console.log('[BOOT TRACE] postRun entered');
        const c = Module.canvas || document.getElementById('canvas');
        const rect = c ? c.getBoundingClientRect() : null;
        console.log('[BOOT TRACE] hasGameBuf=' + !!window.__knightGameBuffer +
            ' canvas=' + !!c +
            ' buffer=' + (c ? c.width + 'x' + c.height : 'n/a') +
            ' layout=' + (rect ? Math.round(rect.width) + 'x' + Math.round(rect.height) : 'n/a'));
    }],
    print: gameLog,
    printErr: (...args) => console.error(...args),

    setStatus: status => {
        console.log('[BOOT TRACE] Emscripten status:',status);
        const element = document.getElementById('status');

        if (element) {
            element.textContent = status;
        }
    }
};


/* =========================================
   Canvas focus
========================================= */

const canvas = document.getElementById('canvas');

if (canvas) {
    canvas.addEventListener('click', () => {
        canvas.focus();
    });
}


/* =========================================
   Keyboard controls
========================================= */

document.addEventListener('keydown', event => {
    if (event.code === 'KeyR' && host) {
        event.preventDefault();
        event.stopImmediatePropagation();
        host.retry();
    } else if (
        event.code === 'Escape' &&
        host &&
        !document.fullscreenElement
    ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        host.menu();
    }
}, true);


/* =========================================
   Runtime error reporting
========================================= */

window.addEventListener('error', event => {
    const status = document.getElementById('status');

    if (status) {
        status.textContent += '\n' + event.message;
    }

    console.error('[DEBUG] Runtime error:', event.message);
    host?.error(event.message);
});


/* =========================================
   Unhandled promise rejection reporting
========================================= */

window.addEventListener('unhandledrejection', event => {
    console.error(
        '[DEBUG] Unhandled promise rejection:',
        event.reason
    );

    host?.error(
        String(event.reason ?? 'Unknown runtime error')
    );
});


// Periodic snapshot while startup is stalled.
(function startupWatchdog(){
    let tick=0;
    setInterval(()=>{
        tick++;
        const canvas=document.getElementById('canvas');
        const rect=canvas?canvas.getBoundingClientRect():null;
        const resources=performance.getEntriesByType('resource').slice(-12).map(r=>({name:r.name.split('/').pop(),duration:Math.round(r.duration),bytes:r.transferSize||0}));
        console.log('[WATCHDOG] alive; tick='+tick+' readyState='+document.readyState+
            ' canvas='+!!canvas+
            ' buffer='+(canvas?canvas.width+'x'+canvas.height:'none')+
            ' layout='+(rect?Math.round(rect.width)+'x'+Math.round(rect.height):'none')+
            ' activeXHR='+xhrSequence+
            ' hasGameBuf='+!!window.__knightGameBuffer+
            ' visibility='+document.visibilityState);
    },10000);
})();
