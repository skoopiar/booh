
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

/* =========================================
   Temporary on-screen debug console
========================================= */

(function installActivityDebugConsole() {
    const panel = document.createElement('div');
    panel.id = 'knight-debug-panel';
    panel.style.cssText = [
        'position:fixed',
        'left:6px',
        'right:6px',
        'bottom:6px',
        'z-index:2147483647',
        'max-height:42%',
        'overflow:auto',
        'padding:8px',
        'background:rgba(0,0,0,.88)',
        'color:#d7ffd7',
        'border:1px solid #67a567',
        'border-radius:5px',
        'font:11px/1.4 monospace',
        'white-space:pre-wrap',
        'overflow-wrap:anywhere',
        'pointer-events:auto'
    ].join(';');

    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;position:sticky;top:0;background:#111;padding:3px;font-weight:bold';
    heading.textContent = 'TEMP DEBUG LOG';

    const hide = document.createElement('button');
    hide.textContent = 'HIDE';
    hide.style.cssText = 'font:11px monospace;color:#111;background:#ddd;border:0;padding:2px 8px';
    heading.appendChild(hide);

    const output = document.createElement('div');
    panel.append(heading, output);
    document.addEventListener('DOMContentLoaded', () => {
        if (!panel.isConnected) document.body.appendChild(panel);
    });
    (document.body || document.documentElement).appendChild(panel);

    hide.addEventListener('click', () => {
        panel.style.display = 'none';
        const reopen = document.createElement('button');
        reopen.textContent = 'SHOW DEBUG';
        reopen.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px monospace';
        reopen.addEventListener('click', () => {
            panel.style.display = 'block';
            reopen.remove();
        });
        document.body.appendChild(reopen);
    });

    function format(value) {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }

    function append(level, args) {
        const line = document.createElement('div');
        line.textContent = '[' + level + '] ' + Array.from(args, format).join(' ');
        if (level === 'ERROR') line.style.color = '#ff9b9b';
        else if (level === 'WARN') line.style.color = '#ffe39b';
        output.appendChild(line);
        while (output.childNodes.length > 160) output.removeChild(output.firstChild);
        panel.scrollTop = panel.scrollHeight;
    }

    for (const level of ['log', 'warn', 'error']) {
        const native = console[level].bind(console);
        console[level] = (...args) => {
            native(...args);
            append(level.toUpperCase(), args);
        };
    }

    append('INFO', ['Debug console installed']);
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


/* =========================================
   XHR request interception
========================================= */

const nativeOpen = XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    console.log('[DEBUG] XHR request:', url);

    if (
        typeof url === 'string' &&
        /(^|\/)game\.unx(?:\?|$)/.test(url) &&
        host?.getGameURL?.()
    ) {
        console.log('[DEBUG] Redirecting game.unx');
        url = host.getGameURL();
    }

    return nativeOpen.call(this, method, url, ...rest);
};


/* =========================================
   Fetch request logging
========================================= */

const nativeFetch = window.fetch;

window.fetch = function(input, init) {
    const url = typeof input === 'string'
        ? input
        : input?.url ?? String(input);

    console.log('[DEBUG] FETCH request:', url);

    return nativeFetch.call(this, input, init);
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

    preRun: [
        function() {
            Module.FS_createPath('/', 'assets', true, true);

            Module.FS_createDataFile(
                '/assets',
                'browser-route.txt',
                new URLSearchParams(location.search).get('route') === 'weird'
                    ? '1'
                    : '0',
                true,
                true
            );
        }
    ],

    postRun: [],
    arguments: [],
    print: gameLog,
    printErr: (...args) => console.error(...args),

    setStatus: status => {
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
