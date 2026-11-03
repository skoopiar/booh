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

// Discord Activity bridge
const host = window.parent !== window
    ? window.parent.knightHost
    : null;

console.log('[DEBUG] Bridge loaded');
console.log('[DEBUG] Has host:', !!host);
console.log(
    '[DEBUG] Has game URL:',
    !!host?.getGameURL?.()
);

// Redirect GameMaker's game.unx request to the downloaded game Blob URL
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

// GameMaker console output and Activity notifications
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

// GameMaker module configuration
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
        document.getElementById('status').textContent = status;
    }
};

// Canvas focus
document.getElementById('canvas').addEventListener('click', () => {
    document.getElementById('canvas').focus();
});

// Keyboard controls
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

// Runtime errors
window.addEventListener('error', event => {
    const status = document.getElementById('status');

    if (status) {
        status.textContent += '\n' + event.message;
    }

    console.error('[DEBUG] Runtime error:', event.message);
    host?.error(event.message);
});