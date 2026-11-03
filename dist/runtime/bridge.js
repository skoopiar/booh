
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
