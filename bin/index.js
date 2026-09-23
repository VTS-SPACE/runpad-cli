#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

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

const args = process.argv.slice(2);
const command = args[0];
const currentDir = process.cwd();

// --- VERSION LOADER ---
function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        return pkg.version || '0.1.0';
    } catch {
        return '0.1.0';
    }
}

// --- PORT & PROCESS MANAGEMENT UTILS ---

function isPortTaken(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', (err) => resolve(err.code === 'EADDRINUSE'))
            .once('listening', () => tester.close(() => resolve(false)))
            .listen(port);
    });
}

function getPidOnPort(port) {
    try {
        if (process.platform === 'win32') {
            const output = execSync('netstat -ano', { encoding: 'utf8' });
            const lines = output.split('\n');
            const portRegex = new RegExp(`[:.]${port}\\s+.*LISTENING\\s+(\\d+)`, 'i');

            for (const line of lines) {
                const match = line.match(portRegex);
                if (match && match[1]) {
                    return match[1].trim();
                }
            }
        } else {
            const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
            const pids = output.trim().split('\n');
            if (pids.length > 0 && pids[0]) return pids[0].trim();
        }
    } catch {
        return null;
    }
    return null;
}

function killProcess(pid) {
    try {
        if (process.platform === 'win32') {
            // /F = Force, /T = Tree kill (child processes included)
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } else {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
        return true;
    } catch {
        return false;
    }
}

// --- BUILT-IN STATIC WEB SERVER ---

function serveStatic(port, autoOpen) {
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    };

    const server = http.createServer((req, res) => {
        let filePath = path.join(currentDir, req.url === '/' ? 'index.html' : req.url);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 Not Found');
                } else {
                    res.writeHead(500);
                    res.end(`Server Error: ${err.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });

    server.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`${c.green}✔ Built-in Web Server live at:${c.reset} ${c.bold}${url}${c.reset}`);
        if (autoOpen) openBrowser(url);
    });
}

function openBrowser(url) {
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
        execSync(`${startCmd} ${url}`);
    } catch {
        // Ignore fallback
    }
}

// --- COMMAND: STANDALONE PORT KILLER ---

async function handleKillCommand(targetPort) {
    const port = parseInt(targetPort, 10);
    if (!port || isNaN(port)) {
        console.error(`${c.red}❌ Error: Valid port number dein! Example: runpad kill 3000${c.reset}`);
        process.exit(1);
    }

    const taken = await isPortTaken(port);
    if (!taken) {
        console.log(`${c.green}✨ Port ${port} is completely free. Nothing to kill!${c.reset}`);
        process.exit(0);
    }

    const pid = getPidOnPort(port);
    if (!pid) {
        console.error(`${c.yellow}⚠️ Port ${port} occupied hai par PID detect nahi ho paya.${c.reset}`);
        process.exit(1);
    }

    console.log(`${c.yellow}⏳ Terminating process tree for PID ${pid} on port ${port}...${c.reset}`);
    const success = killProcess(pid);

    if (success) {
        console.log(`${c.green}✔ Successfully freed port ${port}! (Terminated PID ${pid})${c.reset} 🚀\n`);
    } else {
        console.error(`${c.red}❌ Termination failed. Terminal ko Administrator mode me chalao.${c.reset}`);
    }
    process.exit(0);
}

// --- COMMAND: CHECK COMMONLY USED PORTS ---

async function handlePortsCheck() {
    const commonPorts = [3000, 3001, 4200, 5000, 5173, 8000, 8080, 8888];
    console.log(`\n${c.bold}⚡ RunPad Sentinel — Active Port Audit:${c.reset}\n`);

    for (const port of commonPorts) {
        const busy = await isPortTaken(port);
        if (busy) {
            const pid = getPidOnPort(port) || 'Unknown';
            console.log(`  Port ${c.yellow}${port}${c.reset} : ${c.red}BUSY${c.reset} (PID: ${pid}) ──► ${c.dim}runpad kill ${port}${c.reset}`);
        } else {
            console.log(`  Port ${c.green}${port}${c.reset} : ${c.green}FREE${c.reset}`);
        }
    }
    console.log('');
    process.exit(0);
}

// --- COMMAND: HELP MANUAL ---

function showHelp() {
    console.log(`
${c.bold}${c.cyan}⚡ RunPad CLI — v${getVersion()}${c.reset}
${c.dim}Universal Dev Runner & Port Sentinel${c.reset}

${c.bold}USAGE:${c.reset}
  $ runpad [command] [options]

${c.bold}COMMANDS:${c.reset}
  ${c.green}(default)${c.reset}            Scan workspace, resolve port locks, and start dev server
  ${c.green}kill <port>${c.reset}          Terminate process and free up the port
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

// --- MAIN ENGINE SCANNER & LAUNCHER ---

async function handleDevRun() {
    console.log(`${c.bold}${c.cyan}⚡ RunPad Engine v${getVersion()} — Scanning workspace...${c.reset}\n`);

    const files = fs.readdirSync(currentDir);
    const isOpen = args.includes('--open') || args.includes('-o');
    const isHost = args.includes('--host') || args.includes('-h');

    let portFlagIdx = args.indexOf('--port');
    if (portFlagIdx === -1) portFlagIdx = args.indexOf('-p');
    const explicitPort = portFlagIdx !== -1 ? parseInt(args[portFlagIdx + 1], 10) : null;

    let detectedType = "Unknown";
    let runCommand = "";
    let targetPort = explicitPort || 0;
    let isStatic = false;

    // 1. Node / Vite / Next.js Framework Detection
    if (files.includes('package.json')) {
        try {
            const pkgData = JSON.parse(fs.readFileSync(path.join(currentDir, 'package.json'), 'utf8'));
            const deps = { ...pkgData.dependencies, ...pkgData.devDependencies };

            if (deps.vite) {
                detectedType = "React / Vue / Vite App";
                targetPort = targetPort || 5173;
                let flags = ['--open'];
                if (isHost) flags.push('--host');
                runCommand = `npm run dev -- ${flags.join(' ')}`;
            } else if (deps.next) {
                detectedType = "Next.js App";
                targetPort = targetPort || 3000;
                runCommand = "npm run dev";
            } else if (deps['@nestjs/core']) {
                detectedType = "NestJS Backend";
                targetPort = targetPort || 3000;
                runCommand = "npm run start:dev";
            } else {
                const scripts = pkgData.scripts || {};
                detectedType = "Node.js Application";
                targetPort = targetPort || 3000;
                runCommand = scripts.dev ? "npm run dev" : scripts.start ? "npm start" : "node index.js";
            }
        } catch {
            detectedType = "Node.js Application";
            targetPort = targetPort || 3000;
            runCommand = "npm run dev";
        }
    }
    // 2. Java Spring Boot
    else if (files.includes('pom.xml') || files.includes('build.gradle')) {
        detectedType = "Java Spring Boot";
        targetPort = targetPort || 8080;
        runCommand = files.includes('pom.xml') ? "./mvnw spring-boot:run" : "./gradlew bootRun";
    }
    // 3. .NET Core / C#
    else if (files.some(file => file.endsWith('.csproj') || file.endsWith('.sln'))) {
        detectedType = "C# / .NET Project";
        targetPort = targetPort || 5000;
        runCommand = "dotnet run";
    }
    // 4. Python (FastAPI / Django / Flask)
    else if (files.includes('manage.py')) {
        detectedType = "Python Django App";
        targetPort = targetPort || 8000;
        runCommand = "python manage.py runserver";
    } else if (files.includes('main.py') || files.includes('app.py')) {
        detectedType = "Python Application";
        targetPort = targetPort || 8000;
        runCommand = "python main.py";
    }
    // 5. Static HTML Web
    else if (files.includes('index.html')) {
        detectedType = "Static HTML/Web Project";
        targetPort = targetPort || 3000;
        isStatic = true;
    }

    console.log(`${c.dim}📂 Directory:${c.reset} ${currentDir}`);
    console.log(`${c.dim}🔍 Detected: ${c.reset} ${c.bold}${c.green}${detectedType}${c.reset}`);

    if (!runCommand && !isStatic) {
        console.log(`\n${c.yellow}⚠️ No recognizable framework detected in this directory.${c.reset}`);
        console.log(`💡 Tip: Apne project ke root folder me runpad run karein.\n`);
        return;
    }

    // Pre-flight Port Conflict Check & Sentinel Resolution
    if (targetPort > 0) {
        const taken = await isPortTaken(targetPort);
        if (taken) {
            const pid = getPidOnPort(targetPort);
            console.log(`\n${c.yellow}⚠️  Port Conflict: Port ${targetPort} is currently locked by PID ${pid || 'Unknown'}.${c.reset}`);

            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise((resolve) => {
                rl.question(`${c.cyan}👉 Kill PID ${pid} to free port ${targetPort}? (Y/n): ${c.reset}`, resolve);
            });
            rl.close();

            if (answer.toLowerCase() === 'y' || answer === '') {
                console.log(`${c.dim}⏳ Freeing port ${targetPort}...${c.reset}`);
                killProcess(pid);
                console.log(`${c.green}✔ Port ${targetPort} is released and ready!${c.reset}\n`);
            } else {
                console.log(`${c.red}❌ Aborted: Server cannot bind to occupied port ${targetPort}.${c.reset}\n`);
                return;
            }
        }
    }

    // Launch Engine
    if (isStatic) {
        serveStatic(targetPort, isOpen);
    } else {
        console.log(`${c.dim}🚀 Command:  ${c.reset} ${c.bold}${runCommand}${c.reset}\n`);

        const child = spawn(runCommand, {
            shell: true,
            stdio: 'inherit',
            cwd: currentDir
        });

        child.on('error', (err) => {
            console.error(`${c.red}❌ Execution failed: ${err.message}${c.reset}`);
        });

        child.on('exit', (code) => {
            console.log(`\n${c.dim}🛑 Process exited with status code ${code}${c.reset}`);
        });

        process.on('SIGINT', () => {
            child.kill('SIGINT');
            process.exit();
        });
    }
}

// --- CLI ROUTER ---

if (command === 'kill') {
    handleKillCommand(args[1]);
} else if (command === 'ports') {
    handlePortsCheck();
} else if (command === '--help' || command === 'help') {
    showHelp();
} else if (command === '-v' || command === '--version') {
    console.log(`v${getVersion()}`);
} else {
    handleDevRun();
}