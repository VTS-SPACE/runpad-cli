#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const readline = require('readline');
const { spawn, execSync, spawnSync } = require('child_process');

// --- ANSI Colors (Zero-Dependency) ---
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

// --- RECURSION GUARD ---
if (process.env.__RUNPAD_ACTIVE__ === 'true') {
    console.error(`${c.red}❌ Recursion loop blocked: RunPad cannot spawn another RunPad process.${c.reset}`);
    process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const currentDir = process.cwd();

// --- VERSION LOADER ---
function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        return pkg.version || '0.1.4';
    } catch {
        return '0.1.4';
    }
}

// --- PORT & PROCESS UTILS ---

function isPortTaken(port) {
    const numPort = Number(port);
    if (!Number.isInteger(numPort) || numPort <= 0 || numPort > 65535) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let settled = false;
        const tester = net.createServer();

        const cleanup = () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                tester.removeAllListeners();
            }
        };

        const timer = setTimeout(() => {
            cleanup();
            try { tester.close(); } catch {}
            resolve(false);
        }, 1500);

        tester.once('error', (err) => {
            const isTaken = err.code === 'EADDRINUSE' || err.code === 'EACCES';
            cleanup();
            resolve(isTaken);
        });

        tester.once('listening', () => {
            tester.close(() => {
                cleanup();
                resolve(false);
            });
        });

        try {
            tester.listen(numPort);
        } catch {
            cleanup();
            resolve(true);
        }
    });
}

function parseNetstatForPort(netstatOutput, targetPort) {
    const port = Number(targetPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    if (!netstatOutput || typeof netstatOutput !== 'string') return null;

    const lines = netstatOutput.split(/\r?\n/);
    const pids = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        // Proto  Local Address          Foreign Address        State           PID
        // TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4412
        if (parts.length >= 5 && parts[0].toUpperCase() === 'TCP') {
            const state = parts[3].toUpperCase();
            if (state === 'LISTENING') {
                const localAddr = parts[1];
                const match = localAddr.match(/[:.](\d+)$/);
                if (match && parseInt(match[1], 10) === port) {
                    const pid = parts[4];
                    if (/^\d+$/.test(pid) && pid !== '0' && !pids.includes(pid)) {
                        pids.push(pid);
                    }
                }
            }
        }
    }

    return pids.length > 0 ? pids[0] : null;
}

function getPidOnPort(port) {
    const numPort = Number(port);
    if (!Number.isInteger(numPort) || numPort <= 0 || numPort > 65535) return null;

    try {
        if (process.platform === 'win32') {
            const output = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return parseNetstatForPort(output, numPort);
        } else {
            let output = '';
            try {
                output = execSync(`lsof -ti -sTCP:LISTEN :${numPort}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            } catch {
                try {
                    output = execSync(`lsof -ti :${numPort}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                } catch {}
            }
            const pids = output.trim().split(/\r?\n/);
            for (const pid of pids) {
                const clean = pid.trim();
                if (/^\d+$/.test(clean) && clean !== '0') {
                    return clean;
                }
            }
        }
    } catch {
        return null;
    }
    return null;
}

function isSafePid(pid) {
    if (pid === null || pid === undefined) return false;
    const s = String(pid).trim();
    if (!/^\d+$/.test(s)) return false;
    const num = parseInt(s, 10);
    // Disallow system idle (0), core system (4), RunPad itself, or parent process
    if (num <= 4 || num === process.pid || (process.ppid && num === process.ppid)) {
        return false;
    }
    return true;
}

function getProcessInfo(pid) {
    if (!isSafePid(pid)) return '';
    try {
        if (process.platform === 'win32') {
            const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const match = out.match(/"([^"]+)"/);
            if (match && match[1] && !match[1].toLowerCase().startsWith('info:')) {
                return match[1];
            }
        } else {
            const out = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return out.trim();
        }
    } catch {
        return '';
    }
    return '';
}

function killProcess(pid) {
    const cleanPid = String(pid).trim();
    if (!isSafePid(cleanPid)) return false;

    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${cleanPid}`, { stdio: 'ignore' });
        } else {
            try {
                execSync(`kill -9 -${cleanPid}`, { stdio: 'ignore' });
            } catch {
                execSync(`kill -9 ${cleanPid}`, { stdio: 'ignore' });
            }
        }
        return true;
    } catch {
        return false;
    }
}

// --- CHILD PROCESS MANAGEMENT (CROSS-PLATFORM TREE CLEANUP) ---

const activeChildren = new Set();
let isShuttingDown = false;

function terminateProcessTree(pid) {
    if (!isSafePid(pid)) return;
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } else {
            try {
                process.kill(-pid, 'SIGTERM');
            } catch {
                process.kill(pid, 'SIGTERM');
            }
        }
    } catch {
        // Child or process tree already dead
    }
}

function registerChild(child) {
    if (!child || !child.pid) return;
    activeChildren.add(child);
    child.once('exit', () => activeChildren.delete(child));
}

const RUNPAD_SESSION_MARKER = '.runpad_session';
const cleanupPaths = new Set();
const preExistingCleanupPaths = new Set();

function registerCleanupPath(p) {
    if (p && typeof p === 'string' && path.basename(p) === '.runpad_out') {
        const resolved = path.resolve(p);
        const marker = path.join(resolved, RUNPAD_SESSION_MARKER);
        if (fs.existsSync(resolved) && !fs.existsSync(marker)) {
            preExistingCleanupPaths.add(resolved);
        } else {
            cleanupPaths.add(resolved);
        }
    }
}

function prepareJavaOutputDirectory(outDir) {
    registerCleanupPath(outDir);
    if (!preExistingCleanupPaths.has(outDir)) {
        if (!fs.existsSync(outDir)) {
            try {
                fs.mkdirSync(outDir, { recursive: true });
            } catch {}
        }
        const marker = path.join(outDir, RUNPAD_SESSION_MARKER);
        if (!fs.existsSync(marker)) {
            try {
                fs.writeFileSync(marker, `pid=${process.pid}\ntime=${Date.now()}`);
            } catch {}
        }
    }
}

function cleanupTemporaryFiles() {
    for (const p of cleanupPaths) {
        try {
            if (!preExistingCleanupPaths.has(p) && fs.existsSync(p)) {
                fs.rmSync(p, { recursive: true, force: true });
            }
        } catch {}
    }
    cleanupPaths.clear();
    preExistingCleanupPaths.clear();
}

function cleanupAllChildren() {
    for (const child of activeChildren) {
        if (child.pid) {
            terminateProcessTree(child.pid);
        }
    }
    activeChildren.clear();
    cleanupTemporaryFiles();
}

function initSignalHandlers() {
    const handleSignal = () => {
        if (isShuttingDown) {
            process.exit(1);
        }
        isShuttingDown = true;
        cleanupAllChildren();
        process.exit(0);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
}

process.on('exit', () => {
    cleanupTemporaryFiles();
});

// --- BUILT-IN STATIC WEB SERVER (PATH CONTAINMENT & SECURITY) ---

function isPathContained(parent, target, platform = process.platform) {
    if (!parent || !target) return false;
    let normParent = path.resolve(parent);
    let normTarget = path.resolve(target);
    if (platform === 'win32') {
        normParent = normParent.toLowerCase();
        normTarget = normTarget.toLowerCase();
    }
    const rel = path.relative(normParent, normTarget);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveSafeStaticPath(baseDir, reqUrl, defaultDocument = 'index.html') {
    const rawPath = (reqUrl || '/').split('?')[0].replace(/\\/g, '/');
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(rawPath);
    } catch {
        return { status: 400, error: 'Malformed URI encoding' };
    }

    if (decodedPath.includes('\0')) {
        return { status: 400, error: 'Null byte forbidden' };
    }

    try {
        const secondDecode = decodeURIComponent(decodedPath);
        if (secondDecode !== decodedPath && (secondDecode.includes('..') || secondDecode.includes('/') || secondDecode.includes('\\'))) {
            return { status: 400, error: 'Double encoding forbidden' };
        }
    } catch {
        // Ignore malformed second decode
    }

    const sanitizedRel = (decodedPath === '/' || decodedPath === '')
        ? defaultDocument
        : decodedPath.replace(/^[/\\]+/, '');

    const safeBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(safeBase, sanitizedRel);

    if (!isPathContained(safeBase, resolvedPath)) {
        return { status: 403, error: 'Directory traversal forbidden' };
    }

    return { status: 200, filePath: resolvedPath, relativePath: sanitizedRel };
}

function serveStatic(port, autoOpen, defaultDocument, baseDir = currentDir) {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
    };

    const server = http.createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
            res.end('405 Method Not Allowed');
            return;
        }

        const pathResult = resolveSafeStaticPath(baseDir, req.url, defaultDocument);

        if (pathResult.status === 400) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
            res.end(`400 Bad Request: ${pathResult.error}`);
            return;
        }

        if (pathResult.status === 403) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
            res.end('403 Forbidden: Access Denied');
            return;
        }

        const filePath = pathResult.filePath;
        const safeBase = path.resolve(baseDir);

        fs.stat(filePath, (err, stats) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found');
                return;
            }

            let targetFile = filePath;
            if (stats.isDirectory()) {
                targetFile = path.join(filePath, defaultDocument || 'index.html');
            }

            fs.realpath(targetFile, (realErr, realTarget) => {
                if (realErr || !isPathContained(safeBase, realTarget)) {
                    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('403 Forbidden: Access Denied');
                    return;
                }

                fs.stat(realTarget, (statErr, finalStats) => {
                    if (statErr || !finalStats.isFile()) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('404 Not Found');
                        return;
                    }

                    const ext = path.extname(realTarget).toLowerCase();
                    const contentType = mimeTypes[ext] || 'application/octet-stream';

                    if (req.method === 'HEAD') {
                        res.writeHead(200, { 'Content-Type': contentType });
                        res.end();
                        return;
                    }

                    fs.readFile(realTarget, (readErr, content) => {
                        if (readErr) {
                            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                            res.end('500 Internal Server Error');
                        } else {
                            res.writeHead(200, { 'Content-Type': contentType });
                            res.end(content);
                        }
                    });
                });
            });
        });
    });

    server.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`${c.green}✔ Built-in Web Server live at:${c.reset} ${c.bold}${url}${c.reset}\n`);
        if (autoOpen) openBrowser(url);
    });

    return server;
}

function openBrowser(url) {
    if (!url || typeof url !== 'string') return;
    if (!/^https?:\/\//i.test(url)) return;

    try {
        if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true });
        } else if (process.platform === 'darwin') {
            spawn('open', [url], { stdio: 'ignore' });
        } else {
            spawn('xdg-open', [url], { stdio: 'ignore' });
        }
    } catch {
        // Fallback
    }
}

function waitForPortAndOpen(port, childProcess, maxWaitMs = 15000, intervalMs = 200) {
    if (!port || typeof port !== 'number' || port <= 0) return;
    const startTime = Date.now();
    let hasExited = false;

    if (childProcess && typeof childProcess.once === 'function') {
        childProcess.once('exit', () => {
            hasExited = true;
        });
    }

    const check = () => {
        if (hasExited) {
            return;
        }

        const client = net.connect({ port, host: '127.0.0.1' }, () => {
            client.destroy();
            openBrowser(`http://localhost:${port}`);
        });

        client.on('error', () => {
            client.destroy();
            if (Date.now() - startTime < maxWaitMs && !hasExited) {
                setTimeout(check, intervalMs);
            }
        });
    };

    setTimeout(check, 100);
}

// --- PACKAGE MANAGER & RUNTIME RESOLVERS ---

function detectPackageManager(targetDir, pkgData = {}) {
    if (pkgData && typeof pkgData.packageManager === 'string') {
        const pm = pkgData.packageManager.toLowerCase().split('@')[0].trim();
        if (['pnpm', 'yarn', 'bun', 'npm'].includes(pm)) {
            return pm;
        }
    }

    try {
        const files = fs.readdirSync(targetDir);
        if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
        if (files.includes('pnpm-lock.yaml')) return 'pnpm';
        if (files.includes('yarn.lock')) return 'yarn';
        if (files.includes('package-lock.json')) return 'npm';
    } catch {}

    try {
        const parentDir = path.dirname(targetDir);
        if (parentDir && parentDir !== targetDir) {
            const parentFiles = fs.readdirSync(parentDir);
            if (parentFiles.includes('bun.lockb') || parentFiles.includes('bun.lock')) return 'bun';
            if (parentFiles.includes('pnpm-lock.yaml')) return 'pnpm';
            if (parentFiles.includes('yarn.lock')) return 'yarn';
            if (parentFiles.includes('package-lock.json')) return 'npm';
        }
    } catch {}

    return 'npm';
}

function resolvePythonInterpreter(targetDir) {
    const isWin = process.platform === 'win32';
    const venvDirs = ['.venv', 'venv', 'env'];
    const candidates = [];

    for (const venv of venvDirs) {
        if (isWin) {
            candidates.push(path.join(targetDir, venv, 'Scripts', 'python.exe'));
        } else {
            candidates.push(path.join(targetDir, venv, 'bin', 'python'));
            candidates.push(path.join(targetDir, venv, 'bin', 'python3'));
        }
    }

    const parentDir = path.dirname(targetDir);
    if (parentDir && parentDir !== targetDir) {
        for (const venv of venvDirs) {
            if (isWin) {
                candidates.push(path.join(parentDir, venv, 'Scripts', 'python.exe'));
            } else {
                candidates.push(path.join(parentDir, venv, 'bin', 'python'));
            }
        }
    }

    for (const cand of candidates) {
        try {
            if (fs.existsSync(cand)) {
                return cand;
            }
        } catch {}
    }

    return isWin ? 'python' : 'python3';
}

// --- JAVA TOOLCHAIN & RUNTIME RESOLVERS ---

let cachedJavaToolchain = null;

function detectJavaToolchain(forceRefresh = false, env = process.env, platform = process.platform) {
    if (!forceRefresh && cachedJavaToolchain && env === process.env && platform === process.platform) {
        return cachedJavaToolchain;
    }

    const isWin = platform === 'win32';
    const javaHome = env && env.JAVA_HOME ? env.JAVA_HOME.trim() : null;

    let hasJava = false;
    let hasJavac = false;
    let javaPath = 'java';
    let javacPath = 'javac';
    let javaVersion = null;
    let javacVersion = null;
    let majorVersion = null;

    // 1. Check JAVA_HOME candidates first
    if (javaHome && fs.existsSync(javaHome)) {
        const javaCand = isWin ? path.join(javaHome, 'bin', 'java.exe') : path.join(javaHome, 'bin', 'java');
        const javacCand = isWin ? path.join(javaHome, 'bin', 'javac.exe') : path.join(javaHome, 'bin', 'javac');

        if (fs.existsSync(javaCand)) {
            try {
                const res = spawnSync(javaCand, ['-version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                const out = (res.stderr || '') + (res.stdout || '');
                if (res.status === 0 || out.includes('version')) {
                    hasJava = true;
                    javaPath = javaCand;
                    const vMatch = out.match(/(?:version\s+"|\bversion\s+)([0-9._]+)/i);
                    if (vMatch) javaVersion = vMatch[1];
                }
            } catch {}
        }

        if (fs.existsSync(javacCand)) {
            try {
                const res = spawnSync(javacCand, ['-version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                const out = (res.stdout || '') + (res.stderr || '');
                if (res.status === 0 || out.includes('javac')) {
                    hasJavac = true;
                    javacPath = javacCand;
                    const vMatch = out.match(/javac\s+([0-9._]+)/i);
                    if (vMatch) javacVersion = vMatch[1];
                }
            } catch {}
        }
    }

    // 2. Check system PATH if not found in JAVA_HOME
    if (!hasJava) {
        try {
            const res = spawnSync('java', ['-version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const out = (res.stderr || '') + (res.stdout || '');
            if (res.status === 0 || out.includes('version')) {
                hasJava = true;
                javaPath = 'java';
                const vMatch = out.match(/(?:version\s+"|\bversion\s+)([0-9._]+)/i);
                if (vMatch) javaVersion = vMatch[1];
            }
        } catch {}
    }

    if (!hasJavac) {
        try {
            const res = spawnSync('javac', ['-version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const out = (res.stdout || '') + (res.stderr || '');
            if (res.status === 0 || out.includes('javac')) {
                hasJavac = true;
                javacPath = 'javac';
                const vMatch = out.match(/javac\s+([0-9._]+)/i);
                if (vMatch) javacVersion = vMatch[1];
            }
        } catch {}
    }

    if (javaVersion) {
        const parts = javaVersion.split('.');
        if (parts[0] === '1' && parts[1]) {
            majorVersion = parseInt(parts[1], 10);
        } else {
            majorVersion = parseInt(parts[0], 10) || null;
        }
    }

    const toolchain = {
        hasJava,
        hasJavac,
        isJdk: hasJava && hasJavac,
        javaPath,
        javacPath,
        javaVersion,
        javacVersion,
        majorVersion
    };

    if (env === process.env && platform === process.platform) {
        cachedJavaToolchain = toolchain;
    }

    return toolchain;
}

function findJavaFiles(targetDir) {
    const javaFiles = [];
    const ignoreDirs = new Set([
        'node_modules', '.git', '.runpad_out', 'target', 'build', '.gradle',
        '.idea', 'bin', 'out', '.vscode', 'dist', '.venv', 'venv'
    ]);

    function scan(current) {
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignoreDirs.has(entry.name)) {
                    scan(fullPath);
                }
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.java')) {
                const relativePath = path.relative(targetDir, fullPath).replace(/\\/g, '/');
                javaFiles.push({
                    absolutePath: fullPath,
                    relativePath,
                    fileName: entry.name
                });
            }
        }
    }

    scan(targetDir);
    return javaFiles;
}

function findClasspathJars(targetDir) {
    const jars = [];
    const searchDirs = [targetDir, path.join(targetDir, 'lib'), path.join(targetDir, 'libs')];

    for (const d of searchDirs) {
        if (!fs.existsSync(d)) continue;
        try {
            const files = fs.readdirSync(d);
            for (const f of files) {
                if (f.toLowerCase().endsWith('.jar')) {
                    const rel = path.relative(targetDir, path.join(d, f)).replace(/\\/g, '/');
                    jars.push(rel);
                }
            }
        } catch {}
    }

    return jars;
}

function analyzeJavaSource(filePath) {
    let content = '';
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }

    // Strip comments to avoid matching in commented code
    const cleanContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    const pkgMatch = cleanContent.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m);
    const packageName = pkgMatch ? pkgMatch[1].trim() : null;

    const pubClassMatch = cleanContent.match(/public\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z0-9_]+)/m);
    const anyClassMatch = cleanContent.match(/(?:final\s+|abstract\s+)?class\s+([A-Za-z0-9_]+)/m);

    const fileNameNoExt = path.basename(filePath, path.extname(filePath));
    const className = pubClassMatch ? pubClassMatch[1] : (anyClassMatch ? anyClassMatch[1] : fileNameNoExt);

    const hasMain = /(?:public\s+static\s+void\s+main\s*\(\s*String|\bstatic\s+void\s+main\s*\()/m.test(cleanContent);
    const publicClassMismatch = Boolean(pubClassMatch && pubClassMatch[1] !== fileNameNoExt);

    const fqcn = packageName ? `${packageName}.${className}` : className;

    return {
        filePath,
        fileName: path.basename(filePath),
        packageName,
        className,
        fqcn,
        hasMain,
        publicClassMismatch
    };
}

function selectJavaEntryPoint(targetDir, javaFiles) {
    const candidates = [];

    for (const jf of javaFiles) {
        const analysis = analyzeJavaSource(jf.absolutePath);
        if (analysis && analysis.hasMain) {
            candidates.push({
                ...jf,
                ...analysis
            });
        }
    }

    if (candidates.length === 0) {
        return {
            entryPoint: null,
            candidates: [],
            ambiguous: false,
            error: 'NO_MAIN_METHOD',
            message: 'No main entry point found in Java files. Ensure at least one file defines "public static void main(String[] args)".'
        };
    }

    if (candidates.length === 1) {
        return {
            entryPoint: candidates[0],
            candidates,
            ambiguous: false,
            error: null
        };
    }

    // Multiple candidates with main() - resolve ambiguity
    const preferredNames = ['main.java', 'app.java', 'application.java', 'server.java'];
    let selected = candidates.find(c => preferredNames.includes(c.fileName.toLowerCase()));

    if (!selected) {
        selected = [...candidates].sort((a, b) => a.relativePath.localeCompare(b.relativePath))[0];
    }

    return {
        entryPoint: selected,
        candidates,
        ambiguous: true,
        error: null,
        warning: `Multiple main entry points found (${candidates.map(c => c.relativePath).join(', ')}). Defaulting to ${selected.relativePath}.`
    };
}

function resolveMavenCommand(targetDir, safeExplicitPort = null, platform = process.platform) {
    const isWin = platform === 'win32';
    let wrapper = 'mvn';

    if (isWin) {
        if (fs.existsSync(path.join(targetDir, 'mvnw.cmd'))) {
            wrapper = 'mvnw.cmd';
        } else if (fs.existsSync(path.join(targetDir, 'mvnw.bat'))) {
            wrapper = 'mvnw.bat';
        }
    } else {
        if (fs.existsSync(path.join(targetDir, 'mvnw'))) {
            wrapper = './mvnw';
        }
    }

    let isSpringBoot = false;
    try {
        const pomXml = fs.readFileSync(path.join(targetDir, 'pom.xml'), 'utf8');
        if (pomXml.includes('spring-boot') || pomXml.includes('org.springframework.boot')) {
            isSpringBoot = true;
        }
    } catch {}

    const detectedType = isSpringBoot ? 'Java Spring Boot (Maven)' : 'Java Maven Project';
    const targetPort = safeExplicitPort || 8080;
    let args = [];
    let runCommand = '';

    if (isSpringBoot) {
        args = ['spring-boot:run'];
        if (safeExplicitPort) {
            args.push(`-Dspring-boot.run.arguments=--server.port=${safeExplicitPort}`);
            runCommand = `${wrapper} spring-boot:run -Dspring-boot.run.arguments=--server.port=${safeExplicitPort}`;
        } else {
            runCommand = `${wrapper} spring-boot:run`;
        }
    } else {
        args = ['compile', 'exec:java'];
        runCommand = `${wrapper} compile exec:java`;
    }

    return {
        wrapper,
        executable: wrapper,
        args,
        runCommand,
        detectedType,
        targetPort,
        isSpringBoot
    };
}

function resolveGradleCommand(targetDir, safeExplicitPort = null, platform = process.platform) {
    const isWin = platform === 'win32';
    let wrapper = 'gradle';

    if (isWin) {
        if (fs.existsSync(path.join(targetDir, 'gradlew.bat'))) {
            wrapper = 'gradlew.bat';
        } else if (fs.existsSync(path.join(targetDir, 'gradlew.cmd'))) {
            wrapper = 'gradlew.cmd';
        }
    } else {
        if (fs.existsSync(path.join(targetDir, 'gradlew'))) {
            wrapper = './gradlew';
        }
    }

    let isSpringBoot = false;
    const gradleFiles = ['build.gradle', 'build.gradle.kts'];
    for (const gf of gradleFiles) {
        const full = path.join(targetDir, gf);
        if (fs.existsSync(full)) {
            try {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes('spring-boot') || content.includes('org.springframework.boot')) {
                    isSpringBoot = true;
                    break;
                }
            } catch {}
        }
    }

    const detectedType = isSpringBoot ? 'Java Spring Boot (Gradle)' : 'Java Gradle Project';
    const targetPort = safeExplicitPort || 8080;
    let args = [];
    let runCommand = '';

    if (isSpringBoot) {
        args = ['bootRun'];
        if (safeExplicitPort) {
            args.push(`--args=--server.port=${safeExplicitPort}`);
            runCommand = `${wrapper} bootRun --args=--server.port=${safeExplicitPort}`;
        } else {
            runCommand = `${wrapper} bootRun`;
        }
    } else {
        args = ['run'];
        runCommand = `${wrapper} run`;
    }

    return {
        wrapper,
        executable: wrapper,
        args,
        runCommand,
        detectedType,
        targetPort,
        isSpringBoot
    };
}

// --- PROJECT INSPECTOR (Per-Directory Detection Logic) ---

function inspectDirectory(targetDir, explicitPortOrOptions = null, isHostParam = false, isOpenParam = false) {
    let explicitPort = null;
    let isHost = false;
    let isOpen = false;
    let customPlatform = process.platform;
    let customToolchain = null;

    if (explicitPortOrOptions && typeof explicitPortOrOptions === 'object') {
        explicitPort = explicitPortOrOptions.explicitPort ?? explicitPortOrOptions.port ?? null;
        isHost = Boolean(explicitPortOrOptions.isHost ?? explicitPortOrOptions.host);
        isOpen = Boolean(explicitPortOrOptions.isOpen ?? explicitPortOrOptions.open);
        if (explicitPortOrOptions.platform) customPlatform = explicitPortOrOptions.platform;
        if (explicitPortOrOptions.toolchain) customToolchain = explicitPortOrOptions.toolchain;
    } else {
        explicitPort = explicitPortOrOptions;
        isHost = Boolean(isHostParam);
        isOpen = Boolean(isOpenParam);
    }

    let files = [];
    try {
        files = fs.readdirSync(targetDir);
    } catch {
        return null;
    }

    const htmlFiles = files.filter((file) => {
        if (!file.toLowerCase().endsWith('.html')) return false;
        try {
            return fs.statSync(path.join(targetDir, file)).isFile();
        } catch {
            return false;
        }
    });

    let detectedType = null;
    let runCommand = null;
    let executable = null;
    let args = [];
    let packageManager = null;
    let warning = null;
    const safeExplicitPort = Number.isInteger(Number(explicitPort)) && Number(explicitPort) >= 1 && Number(explicitPort) <= 65535
        ? Number(explicitPort)
        : null;
    let targetPort = safeExplicitPort || 0;
    let isStatic = false;
    let defaultDocument = null;

    // 1. Node / Vite / Next / Nest Detection
    if (files.includes('package.json')) {
        try {
            const pkgData = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
            const deps = { ...pkgData.dependencies, ...pkgData.devDependencies };
            const pm = detectPackageManager(targetDir, pkgData);
            packageManager = pm;

            if (deps.vite) {
                detectedType = "React / Vue / Vite App";
                targetPort = targetPort || 5173;
                executable = pm;
                args = ['run', 'dev'];

                const flags = [];
                if (isHost) flags.push('--host');
                if (safeExplicitPort) flags.push(`--port`, String(safeExplicitPort));
                if (isOpen) flags.push('--open');

                if (flags.length > 0) {
                    args.push('--', ...flags);
                }

                const flagStr = flags.length > 0 ? ` -- ${flags.join(' ')}` : '';
                runCommand = `${pm} run dev${flagStr}`;
            } else if (deps.next) {
                detectedType = "Next.js App";
                targetPort = targetPort || 3000;
                executable = pm;
                args = ['run', 'dev'];
                if (safeExplicitPort) {
                    args.push('--', '-p', String(safeExplicitPort));
                    runCommand = `${pm} run dev -- -p ${safeExplicitPort}`;
                } else {
                    runCommand = `${pm} run dev`;
                }
            } else if (deps['@nestjs/core']) {
                detectedType = "NestJS Backend";
                targetPort = targetPort || 3000;
                executable = pm;
                const scripts = pkgData.scripts || {};
                const nestScript = scripts['start:dev'] ? 'start:dev' : (scripts.dev ? 'dev' : 'start');
                args = ['run', nestScript];
                runCommand = `${pm} run ${nestScript}`;
            } else {
                const scripts = pkgData.scripts || {};
                detectedType = "Node.js Application";
                targetPort = targetPort || 3000;

                if (scripts.dev) {
                    executable = pm;
                    args = ['run', 'dev'];
                    runCommand = `${pm} run dev`;
                } else if (scripts.start) {
                    executable = pm;
                    args = ['run', 'start'];
                    runCommand = `${pm} run start`;
                } else if (scripts.serve) {
                    executable = pm;
                    args = ['run', 'serve'];
                    runCommand = `${pm} run serve`;
                } else if (pkgData.main && typeof pkgData.main === 'string' && fs.existsSync(path.join(targetDir, path.normalize(pkgData.main).replace(/["`$;|&<>\r\n]/g, '')))) {
                    const cleanMain = path.normalize(pkgData.main).replace(/["`$;|&<>\r\n]/g, '');
                    if (!cleanMain.startsWith('-')) {
                        executable = 'node';
                        args = [cleanMain];
                        runCommand = `node "${cleanMain}"`;
                    }
                } else if (fs.existsSync(path.join(targetDir, 'index.js'))) {
                    executable = 'node';
                    args = ['index.js'];
                    runCommand = `node "index.js"`;
                } else if (fs.existsSync(path.join(targetDir, 'server.js'))) {
                    executable = 'node';
                    args = ['server.js'];
                    runCommand = `node "server.js"`;
                } else if (fs.existsSync(path.join(targetDir, 'app.js'))) {
                    executable = 'node';
                    args = ['app.js'];
                    runCommand = `node "app.js"`;
                }
            }
        } catch {
            detectedType = "Node.js Application";
            targetPort = targetPort || 3000;
            executable = 'npm';
            args = ['run', 'dev'];
            runCommand = "npm run dev";
            packageManager = 'npm';
        }
    }
    // 2. Java Maven
    else if (files.includes('pom.xml')) {
        const mavenInfo = resolveMavenCommand(targetDir, safeExplicitPort, customPlatform);
        detectedType = mavenInfo.detectedType;
        targetPort = mavenInfo.targetPort;
        executable = mavenInfo.executable;
        args = mavenInfo.args;
        runCommand = mavenInfo.runCommand;
    }
    // 3. Java Gradle
    else if (files.includes('build.gradle') || files.includes('build.gradle.kts')) {
        const gradleInfo = resolveGradleCommand(targetDir, safeExplicitPort, customPlatform);
        detectedType = gradleInfo.detectedType;
        targetPort = gradleInfo.targetPort;
        executable = gradleInfo.executable;
        args = gradleInfo.args;
        runCommand = gradleInfo.runCommand;
    }
    // 4. Standalone Java Application
    else if (findJavaFiles(targetDir).length > 0) {
        const javaFiles = findJavaFiles(targetDir);
        const toolchain = customToolchain || detectJavaToolchain(false, process.env, customPlatform);
        const entryResult = selectJavaEntryPoint(targetDir, javaFiles);
        const jars = findClasspathJars(targetDir);

        targetPort = safeExplicitPort || 8080;

        if (entryResult.error) {
            detectedType = "Java Application";
            return {
                targetDir,
                detectedType,
                executable: null,
                args: [],
                runCommand: null,
                targetPort,
                error: entryResult.error,
                diagnostics: entryResult.message,
                javaFiles
            };
        }

        const entryPoint = entryResult.entryPoint;
        const isSingleFile = (javaFiles.length === 1 && jars.length === 0 && (!toolchain.majorVersion || toolchain.majorVersion >= 11));

        if (isSingleFile) {
            if (!toolchain.hasJava) {
                detectedType = "Standalone Java (Single-File)";
                return {
                    targetDir,
                    detectedType,
                    executable: null,
                    args: [],
                    runCommand: null,
                    targetPort,
                    error: 'JAVA_NOT_FOUND',
                    diagnostics: 'Java runtime ("java") not found. Install Java (JRE or JDK) and add it to PATH or set JAVA_HOME.',
                    javaFiles
                };
            }

            detectedType = "Standalone Java (Single-File)";
            executable = toolchain.javaPath;
            const cleanRel = entryPoint.relativePath.replace(/["`$;|&<>\r\n]/g, '');
            args = [cleanRel];
            const qJava = toolchain.javaPath.includes(' ') ? `"${toolchain.javaPath}"` : toolchain.javaPath;
            const qFile = cleanRel.includes(' ') ? `"${cleanRel}"` : cleanRel;
            runCommand = `${qJava} ${qFile}`;
            if (entryResult.warning) {
                warning = entryResult.warning;
            }
        } else {
            if (!toolchain.hasJavac) {
                detectedType = "Standalone Java (Multi-File)";
                return {
                    targetDir,
                    detectedType,
                    executable: null,
                    args: [],
                    runCommand: null,
                    targetPort,
                    error: 'JDK_REQUIRED',
                    diagnostics: 'JDK compiler ("javac") not found. Multi-file Java projects require a full JDK (not just JRE). Install OpenJDK and ensure "javac" is in PATH or JAVA_HOME.',
                    javaFiles
                };
            }

            detectedType = "Standalone Java (Multi-File)";
            const outDir = path.join(targetDir, '.runpad_out');
            prepareJavaOutputDirectory(outDir);

            const cleanJars = jars.map(j => j.replace(/["`$;|&<>\r\n]/g, ''));
            const cpCompile = cleanJars.length > 0 ? cleanJars.map(j => `"${j}"`).join(path.delimiter) : null;
            const cpRunEntries = ['.runpad_out', ...cleanJars];
            const cpRun = cpRunEntries.map(e => `"${e}"`).join(path.delimiter);

            const qJavac = toolchain.javacPath.includes(' ') ? `"${toolchain.javacPath}"` : toolchain.javacPath;
            const qJava = toolchain.javaPath.includes(' ') ? `"${toolchain.javaPath}"` : toolchain.javaPath;
            const cleanSources = javaFiles.map(f => {
                const clean = f.relativePath.replace(/["`$;|&<>\r\n]/g, '');
                return clean.includes(' ') ? `"${clean}"` : clean;
            }).join(' ');
            const cleanFqcn = entryPoint.fqcn.replace(/["`$;|&<>\r\n]/g, '');

            const compileCpArg = cpCompile ? `-cp ${cpCompile} ` : '';
            const compileCmd = `${qJavac} -d ".runpad_out" ${compileCpArg}${cleanSources}`;
            const runCmd = `${qJava} -cp ${cpRun} ${cleanFqcn}`;

            executable = toolchain.javaPath;
            args = ['-cp', cpRunEntries.join(path.delimiter), cleanFqcn];
            runCommand = `${compileCmd} && ${runCmd}`;

            if (entryResult.warning) {
                warning = entryResult.warning;
            }
        }
    }
    // 3. .NET Core
    else if (files.some(file => file.endsWith('.csproj') || file.endsWith('.sln'))) {
        detectedType = "C# / .NET Project";
        targetPort = targetPort || 5000;
        executable = 'dotnet';

        const csprojFiles = files.filter(f => f.endsWith('.csproj'));
        let selectedProject = null;

        if (csprojFiles.length === 1) {
            selectedProject = csprojFiles[0];
        } else if (csprojFiles.length > 1) {
            const nonTest = csprojFiles.filter(f => !/test|tests|unittests/i.test(f));
            const pool = nonTest.length > 0 ? nonTest : csprojFiles;
            const preferred = pool.find(f => /web|api|server|app|main/i.test(f));
            selectedProject = preferred || pool[0];
        }

        args = ['run'];
        const cmdParts = ['dotnet', 'run'];

        if (selectedProject) {
            const cleanProject = selectedProject.replace(/["`$;|&<>\r\n]/g, '');
            if (!cleanProject.startsWith('-')) {
                args.push('--project', cleanProject);
                cmdParts.push('--project', `"${cleanProject}"`);
            }
        }
        if (safeExplicitPort) {
            const urlVal = `http://localhost:${safeExplicitPort}`;
            args.push('--urls', urlVal);
            cmdParts.push('--urls', urlVal);
        }

        runCommand = cmdParts.join(' ');
    }
    // 4. Python Projects
    else if (files.includes('manage.py')) {
        detectedType = "Python Django App";
        targetPort = targetPort || 8000;
        const pyExe = resolvePythonInterpreter(targetDir);
        executable = pyExe;
        const djangoPort = safeExplicitPort || 8000;
        args = ['manage.py', 'runserver', String(djangoPort)];
        runCommand = pyExe.includes(' ')
            ? `"${pyExe}" manage.py runserver ${djangoPort}`
            : `${pyExe} manage.py runserver ${djangoPort}`;
    } else if (files.some(f => f.endsWith('.py'))) {
        const mainPy = files.find(f => ['main.py', 'app.py', 'server.py', 'run.py', 'api.py'].includes(f.toLowerCase())) || files.find(f => f.endsWith('.py'));
        const cleanMainPy = path.basename(mainPy).replace(/["`$;|&<>\r\n]/g, '');
        if (cleanMainPy && !cleanMainPy.startsWith('-')) {
            detectedType = "Python Application";
            targetPort = targetPort || 8000;
            const pyExe = resolvePythonInterpreter(targetDir);
            executable = pyExe;
            args = [cleanMainPy];
            runCommand = pyExe.includes(' ')
                ? `"${pyExe}" "${cleanMainPy}"`
                : `${pyExe} "${cleanMainPy}"`;
        }
    }
    // 5. Static HTML Web
    else if (htmlFiles.length > 0) {
        defaultDocument = htmlFiles.find(file => file.toLowerCase() === 'index.html') || htmlFiles[0];
        detectedType = "Static HTML/Web Project";
        targetPort = targetPort || 3000;
        isStatic = true;
        executable = 'node';
        args = ['serveStatic'];
        runCommand = `serveStatic ${defaultDocument}`;
    }

    if (!detectedType) return null;

    return {
        targetDir,
        detectedType,
        executable,
        args,
        runCommand,
        packageManager,
        targetPort,
        isStatic,
        defaultDocument,
        htmlFiles,
        warning
    };
}

// --- SENTINEL: PORT CONFLICT RESOLVER ---

async function resolvePortConflict(targetPort) {
    if (!targetPort || targetPort <= 0) return true;

    const taken = await isPortTaken(targetPort);
    if (taken) {
        const pid = getPidOnPort(targetPort);
        const procName = pid ? getProcessInfo(pid) : '';
        const procLabel = procName ? ` (${procName})` : '';

        if (!pid) {
            console.log(`\n${c.yellow}⚠️  Port Conflict: Port ${targetPort} is currently occupied or reserved by the system, but no user process PID was detected.${c.reset}`);
            console.log(`${c.red}❌ Aborted: Cannot safely bind to port ${targetPort}.${c.reset}\n`);
            return false;
        }

        if (!isSafePid(pid)) {
            console.log(`\n${c.yellow}⚠️  Port Conflict: Port ${targetPort} is locked by system PID ${pid}${procLabel}.${c.reset}`);
            console.log(`${c.red}❌ Aborted: RunPad will not terminate protected system processes.${c.reset}\n`);
            return false;
        }

        console.log(`\n${c.yellow}⚠️  Port Conflict: Port ${targetPort} is currently locked by PID ${pid}${procLabel}.${c.reset}`);

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise((resolve) => {
            rl.question(`${c.cyan}👉 Kill PID ${pid}${procLabel} to free port ${targetPort}? (Y/n): ${c.reset}`, resolve);
        });
        rl.close();

        if (answer.toLowerCase() === 'y' || answer === '') {
            // Re-verify port state and PID ownership before executing termination
            const stillTaken = await isPortTaken(targetPort);
            if (!stillTaken) {
                console.log(`${c.green}✔ Port ${targetPort} was already freed while waiting.${c.reset}\n`);
                return true;
            }

            const currentPid = getPidOnPort(targetPort);
            if (!currentPid || currentPid !== pid) {
                console.log(`\n${c.yellow}⚠️ Port ${targetPort} state or listening process changed (now PID ${currentPid || 'none'}). Aborting kill to protect unrelated processes.${c.reset}\n`);
                return false;
            }

            if (!isSafePid(currentPid)) {
                console.log(`\n${c.red}❌ Aborted: PID ${currentPid} is a protected process.${c.reset}\n`);
                return false;
            }

            console.log(`${c.dim}⏳ Freeing port ${targetPort}...${c.reset}`);
            const killed = killProcess(pid);
            if (!killed) {
                console.log(`${c.red}❌ Termination failed for PID ${pid}. Run terminal as Administrator.${c.reset}\n`);
                return false;
            }

            let freed = false;
            for (let i = 0; i < 10; i++) {
                await new Promise((r) => setTimeout(r, 150));
                const recheckTaken = await isPortTaken(targetPort);
                if (!recheckTaken) {
                    freed = true;
                    break;
                }
            }

            if (freed) {
                console.log(`${c.green}✔ Port ${targetPort} is released and ready!${c.reset}\n`);
                return true;
            } else {
                console.log(`${c.red}❌ Port ${targetPort} is still occupied after terminating PID ${pid}.${c.reset}\n`);
                return false;
            }
        } else {
            console.log(`${c.red}❌ Aborted: Server cannot bind to occupied port ${targetPort}.${c.reset}\n`);
            return false;
        }
    }
    return true;
}

// --- SUBCOMMANDS ---

async function handleKillCommand(targetPort) {
    const port = parseInt(targetPort, 10);
    if (!port || isNaN(port) || port <= 0 || port > 65535) {
        console.error(`${c.red}❌ Error: Valid port number dein (1-65535)! Example: runpad kill 3000${c.reset}`);
        process.exit(1);
    }

    const taken = await isPortTaken(port);
    if (!taken) {
        console.log(`${c.green}✨ Port ${port} is completely free. Nothing to kill!${c.reset}`);
        process.exit(0);
    }

    const pid = getPidOnPort(port);
    const procName = pid ? getProcessInfo(pid) : '';
    const procLabel = procName ? ` (${procName})` : '';

    if (!pid) {
        console.error(`${c.yellow}⚠️ Port ${port} occupied hai par user-space PID detect nahi ho paya.${c.reset}`);
        process.exit(1);
    }

    if (!isSafePid(pid)) {
        console.error(`${c.red}❌ Port ${port} system process (PID ${pid}${procLabel}) ke pass hai. RunPad ise terminate nahi karega.${c.reset}`);
        process.exit(1);
    }

    // Re-verify port state and PID ownership before executing termination
    const recheckPid = getPidOnPort(port);
    if (!recheckPid || recheckPid !== pid) {
        console.error(`${c.yellow}⚠️ Port ${port} listening process changed or exited. Aborting termination.${c.reset}`);
        process.exit(1);
    }

    if (!isSafePid(recheckPid)) {
        console.error(`${c.red}❌ Port ${port} system process (PID ${recheckPid}${procLabel}) ke pass hai. RunPad ise terminate nahi karega.${c.reset}`);
        process.exit(1);
    }

    console.log(`${c.yellow}⏳ Terminating process tree for PID ${pid}${procLabel} on port ${port}...${c.reset}`);
    const success = killProcess(pid);

    if (success) {
        let freed = false;
        for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 150));
            const stillTaken = await isPortTaken(port);
            if (!stillTaken) {
                freed = true;
                break;
            }
        }

        if (freed) {
            console.log(`${c.green}✔ Successfully freed port ${port}! (Terminated PID ${pid}${procLabel})${c.reset} 🚀\n`);
        } else {
            console.log(`${c.yellow}⚠️ Process terminated (PID ${pid}), but port ${port} is still releasing in OS...${c.reset}\n`);
        }
    } else {
        console.error(`${c.red}❌ Termination failed. Terminal ko Administrator mode me chalao.${c.reset}`);
    }
    process.exit(0);
}

async function handlePortsCheck() {
    const commonPorts = [3000, 3001, 4200, 5000, 5173, 8000, 8080, 8888];
    console.log(`\n${c.bold}⚡ RunPad Sentinel — Active Port Audit:${c.reset}\n`);

    for (const port of commonPorts) {
        const busy = await isPortTaken(port);
        if (busy) {
            const pid = getPidOnPort(port) || 'Unknown';
            const procName = pid !== 'Unknown' ? getProcessInfo(pid) : '';
            const procLabel = procName ? ` (${procName})` : '';
            console.log(`  Port ${c.yellow}${port}${c.reset} : ${c.red}BUSY${c.reset} (PID: ${pid}${procLabel}) ──► ${c.dim}runpad kill ${port}${c.reset}`);
        } else {
            console.log(`  Port ${c.green}${port}${c.reset} : ${c.green}FREE${c.reset}`);
        }
    }
    console.log('');
    process.exit(0);
}

function showHelp() {
    console.log(`
${c.bold}${c.cyan}⚡ RunPad CLI — v${getVersion()}${c.reset}
${c.dim}Universal Dev Runner & Port Sentinel${c.reset}

${c.bold}USAGE:${c.reset}
  $ runpad [command] [options]

${c.bold}COMMANDS:${c.reset}
  ${c.green}(default)${c.reset}            Scan workspace (root & fullstack subfolders), resolve port locks, and start
  ${c.green}kill <port>${c.reset}          Terminate process tree and free up the port
  ${c.green}ports${c.reset}                Audit common dev ports (3000, 5173, 8080, etc.)
  ${c.green}help, --help${c.reset}         Display this guide
  ${c.green}-v, --version${c.reset}        Show current version

${c.bold}OPTIONS & FLAGS:${c.reset}
  ${c.yellow}-o, --open${c.reset}           Auto-open browser on launch
  ${c.yellow}-h, --host${c.reset}           Expose development server to Wi-Fi / Local Network
  ${c.yellow}-p, --port <number>${c.reset}  Override target port check

${c.bold}EXAMPLES:${c.reset}
  $ runpad
  $ runpad --host
  $ runpad ports
  $ runpad kill 5173
`);
    process.exit(0);
}

// --- WORKSPACE SCANNER & RUNNER ---

async function handleDevRun() {
    console.log(`${c.bold}${c.cyan}⚡ RunPad Engine v${getVersion()} — Scanning workspace...${c.reset}\n`);

    // Protect runpad-cli root directory from self-execution
    try {
        const localPkg = JSON.parse(fs.readFileSync(path.join(currentDir, 'package.json'), 'utf8'));
        if (localPkg.name === 'runpad-cli' && currentDir === path.resolve(__dirname, '..')) {
            console.log(`${c.yellow}⚠️  You are inside the runpad-cli source directory.${c.reset}`);
            console.log(`💡 To test RunPad, navigate to another project folder (e.g., React, Python, or HTML folder) and run 'runpad'.\n`);
            return;
        }
    } catch {
        // Ignore
    }

    const isOpen = args.includes('--open') || args.includes('-o');
    const isHost = args.includes('--host') || args.includes('-h');
    let portFlagIdx = args.indexOf('--port');
    if (portFlagIdx === -1) portFlagIdx = args.indexOf('-p');
    const explicitPort = portFlagIdx !== -1 ? parseInt(args[portFlagIdx + 1], 10) : null;

    const inspectOpts = { explicitPort, isHost, isOpen };

    // 1. First check: Current Directory Root
    let rootProject = inspectDirectory(currentDir, inspectOpts);

    // 2. If nothing at root, scan subdirectories for Fullstack Workspace
    let subProjects = [];
    if (!rootProject) {
        const ignoreDirs = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '.vscode', 'bin']);
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !ignoreDirs.has(entry.name)) {
                    const subPath = path.join(currentDir, entry.name);
                    const project = inspectDirectory(subPath, inspectOpts);
                    if (project) {
                        project.folderName = entry.name;
                        subProjects.push(project);
                    }
                }
            }
        } catch {
            // Ignore read errors
        }
    }

    console.log(`${c.dim}📂 Directory:${c.reset} ${currentDir}`);

    // CASE A: Single Project at Root
    if (rootProject) {
        if (rootProject.error) {
            console.log(`${c.dim}🔍 Detected: ${c.reset} ${c.bold}${c.red}${rootProject.detectedType || 'Java Application'}${c.reset}`);
            console.log(`\n${c.red}❌ Error: ${rootProject.diagnostics || rootProject.error}${c.reset}\n`);
            process.exitCode = 1;
            return;
        }

        console.log(`${c.dim}🔍 Detected: ${c.reset} ${c.bold}${c.green}${rootProject.detectedType}${c.reset}`);
        if (rootProject.warning) {
            console.log(`${c.yellow}⚠️  ${rootProject.warning}${c.reset}`);
        }
        if (rootProject.packageManager) {
            console.log(`${c.dim}📦 Package Manager:${c.reset} ${c.bold}${rootProject.packageManager}${c.reset}`);
        }
        if (rootProject.isStatic) {
            console.log(`${c.dim}📄 HTML Files:${c.reset} ${rootProject.htmlFiles.join(', ')}`);
            console.log(`${c.dim}🌐 Serving at /:${c.reset} ${c.bold}${rootProject.defaultDocument}${c.reset}`);
        }

        const ready = await resolvePortConflict(rootProject.targetPort);
        if (!ready) return;

        if (rootProject.isStatic) {
            serveStatic(rootProject.targetPort, isOpen, rootProject.defaultDocument, rootProject.targetDir);
        } else {
            console.log(`${c.dim}🚀 Command:  ${c.reset} ${c.bold}${rootProject.runCommand}${c.reset}\n`);
            const child = spawn(rootProject.runCommand, {
                shell: true,
                stdio: 'inherit',
                cwd: rootProject.targetDir,
                env: { ...process.env, __RUNPAD_ACTIVE__: 'true' }
            });
            registerChild(child);
            initSignalHandlers();

            child.on('error', (err) => {
                if (err.code === 'ENOENT') {
                    console.error(`\n${c.red}❌ Execution failed: Required executable not found in PATH.${c.reset}`);
                    console.error(`${c.dim}Command: ${rootProject.runCommand}${c.reset}\n`);
                } else {
                    console.error(`\n${c.red}❌ Execution failed: ${err.message}${c.reset}\n`);
                }
            });

            // Vite natively opens browser when passed --open; other frameworks need browser opener
            const isVite = rootProject.detectedType && rootProject.detectedType.includes('Vite');
            if (isOpen && !isVite && rootProject.targetPort > 0) {
                waitForPortAndOpen(rootProject.targetPort, child);
            }
        }
        return;
    }

    // CASE B: Fullstack / Multi-Service Workspace Detected
    if (subProjects.length > 0) {
        for (const p of subProjects) {
            if (p.error) {
                console.log(`\n${c.red}❌ [${p.folderName}] Configuration Error: ${p.diagnostics || p.error}${c.reset}\n`);
                process.exitCode = 1;
                return;
            }
        }

        console.log(`${c.dim}🔍 Detected: ${c.reset} ${c.bold}${c.green}Multi-Service Workspace (${subProjects.length} services found)${c.reset}`);
        subProjects.forEach((p, idx) => {
            const prefix = idx === subProjects.length - 1 ? '└──' : '├──';
            const pmLabel = p.packageManager ? ` (${p.packageManager})` : '';
            console.log(`  ${c.dim}${prefix}${c.reset} [${c.cyan}${p.folderName}${c.reset}] ${p.detectedType}${pmLabel} ${c.dim}(Port ${p.targetPort || 'Auto'})${c.reset}`);
            if (p.warning) {
                console.log(`      ${c.yellow}⚠️  ${p.warning}${c.reset}`);
            }
        });
        console.log('');

        // Pre-flight Sentinel for ALL detected services
        for (const p of subProjects) {
            if (p.targetPort > 0) {
                const ready = await resolvePortConflict(p.targetPort);
                if (!ready) return;
            }
        }

        // Launch all detected services concurrently
        let webServiceToOpen = null;
        let webServiceChild = null;
        subProjects.forEach((p) => {
            if (p.isStatic) {
                serveStatic(p.targetPort, isOpen, p.defaultDocument, p.targetDir);
            } else {
                console.log(`🚀 [${c.cyan}${p.folderName}${c.reset}] Launching: ${c.bold}${p.runCommand}${c.reset}`);
                const child = spawn(p.runCommand, {
                    shell: true,
                    stdio: 'inherit',
                    cwd: p.targetDir,
                    env: { ...process.env, __RUNPAD_ACTIVE__: 'true' }
                });
                registerChild(child);

                child.on('error', (err) => {
                    console.error(`\n${c.red}❌ [${p.folderName}] Execution failed: ${err.message}${c.reset}\n`);
                });

                if (!webServiceToOpen && p.targetPort > 0) {
                    webServiceToOpen = p;
                    webServiceChild = child;
                }
            }
        });
        initSignalHandlers();

        if (isOpen && webServiceToOpen) {
            const isVite = webServiceToOpen.detectedType && webServiceToOpen.detectedType.includes('Vite');
            if (!isVite && webServiceToOpen.targetPort > 0) {
                waitForPortAndOpen(webServiceToOpen.targetPort, webServiceChild);
            }
        }

        return;
    }

    // CASE C: Nothing Found
    console.log(`${c.dim}🔍 Detected: ${c.reset} ${c.bold}${c.yellow}Unknown${c.reset}`);
    console.log(`\n${c.yellow}⚠️ No runnable project detected in this directory or its subfolders.${c.reset}`);
    console.log(`${c.dim}RunPad searches for standard markers:${c.reset}`);
    console.log(`  • ${c.green}Node.js / Web:${c.reset}  package.json (Vite, Next.js, NestJS, Express)`);
    console.log(`  • ${c.green}Python:${c.reset}         manage.py, main.py, app.py`);
    console.log(`  • ${c.green}.NET / C#:${c.reset}      *.csproj, *.sln`);
    console.log(`  • ${c.green}Java / Maven:${c.reset}   pom.xml, build.gradle, *.java`);
    console.log(`  • ${c.green}Static Web:${c.reset}     index.html\n`);
    console.log(`💡 ${c.dim}Check current directory or run:${c.reset} ${c.cyan}runpad ports${c.reset} or ${c.cyan}runpad --help${c.reset}\n`);
    process.exitCode = 1;
}

// --- CLI ROUTER ---

const validCommands = ['kill', 'ports', 'help', '--help', '-v', '--version'];

if (require.main === module) {
    if (command === 'kill') {
        handleKillCommand(args[1]);
    } else if (command === 'ports') {
        handlePortsCheck();
    } else if (command === '--help' || command === 'help') {
        showHelp();
    } else if (command === '-v' || command === '--version') {
        console.log(`v${getVersion()}`);
    } else if (command && !command.startsWith('-') && !validCommands.includes(command)) {
        console.log(`\n${c.red}❌ Unknown command: "${command}"${c.reset}`);
        if (['link', 'install', 'i', 'build', 'test', 'init', 'publish'].includes(command)) {
            console.log(`💡 Did you mean: ${c.bold}${c.green}npm ${command}${c.reset} ?`);
        }
        console.log(`Run ${c.cyan}runpad --help${c.reset} to see all supported options.\n`);
        process.exit(1);
    } else {
        handleDevRun();
    }
}

module.exports = {
    isPortTaken,
    getPidOnPort,
    killProcess,
    isSafePid,
    getProcessInfo,
    parseNetstatForPort,
    isPathContained,
    resolveSafeStaticPath,
    terminateProcessTree,
    detectPackageManager,
    resolvePythonInterpreter,
    detectJavaToolchain,
    findJavaFiles,
    findClasspathJars,
    analyzeJavaSource,
    selectJavaEntryPoint,
    resolveMavenCommand,
    resolveGradleCommand,
    registerCleanupPath,
    prepareJavaOutputDirectory,
    cleanupTemporaryFiles,
    cleanupPaths,
    preExistingCleanupPaths,
    RUNPAD_SESSION_MARKER,
    inspectDirectory,
    serveStatic,
    openBrowser,
    waitForPortAndOpen,
    getVersion
};
