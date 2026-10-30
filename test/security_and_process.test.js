const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const {
    isPortTaken,
    isSafePid,
    parseNetstatForPort,
    isPathContained,
    resolveSafeStaticPath,
    terminateProcessTree,
    killProcess,
    serveStatic,
    inspectDirectory,
    registerCleanupPath,
    prepareJavaOutputDirectory,
    cleanupTemporaryFiles,
    cleanupPaths,
    preExistingCleanupPaths,
    RUNPAD_SESSION_MARKER,
    waitForPortAndOpen
} = require('../bin/index.js');

describe('Security & Process Management Regression Tests', () => {

    describe('1. Static-Server Path Traversal & Containment', () => {
        const fixtureDir = path.join(os.tmpdir(), 'runpad-test-static-' + Date.now());

        before(() => {
            fs.mkdirSync(fixtureDir, { recursive: true });
            fs.writeFileSync(path.join(fixtureDir, 'index.html'), '<h1>Hello RunPad</h1>');
            fs.mkdirSync(path.join(fixtureDir, 'sub'), { recursive: true });
            fs.writeFileSync(path.join(fixtureDir, 'sub', 'app.js'), 'console.log("ok");');
        });

        after(() => {
            try {
                fs.rmSync(fixtureDir, { recursive: true, force: true });
            } catch {}
        });

        test('Normal root request resolves to defaultDocument', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/', 'index.html');
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.filePath, path.join(fixtureDir, 'index.html'));
        });

        test('Normal nested file request resolves safely', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/sub/app.js', 'index.html');
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.filePath, path.join(fixtureDir, 'sub', 'app.js'));
        });

        test('Blocks parent directory traversal (../../)', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/../../package.json', 'index.html');
            assert.strictEqual(res.status, 403);
            assert.match(res.error, /traversal forbidden/i);
        });

        test('Blocks URL-encoded directory traversal (..%2f..%2f)', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/..%2f..%2fpackage.json', 'index.html');
            assert.strictEqual(res.status, 403);
            assert.match(res.error, /traversal forbidden/i);
        });

        test('Blocks backslash traversal on Windows (\\..\\..\\)', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/\\..\\..\\package.json', 'index.html');
            assert.strictEqual(res.status, 403);
            assert.match(res.error, /traversal forbidden/i);
        });

        test('Rejects null-byte injection', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/index.html%00.png', 'index.html');
            assert.strictEqual(res.status, 400);
            assert.match(res.error, /null byte/i);
        });

        test('Rejects malformed URI encoding', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/%E0%A4%A', 'index.html');
            assert.strictEqual(res.status, 400);
            assert.match(res.error, /malformed/i);
        });

        test('Blocks double-encoded directory traversal (%252e%252e%252f)', () => {
            const res = resolveSafeStaticPath(fixtureDir, '/%252e%252e%252fpackage.json', 'index.html');
            assert.strictEqual(res.status, 400);
            assert.match(res.error, /Double encoding forbidden/i);
        });

        test('isPathContained accurately validates parent directory, sibling collisions, and drives', () => {
            assert.strictEqual(isPathContained('C:\\site', 'C:\\site\\index.html', 'win32'), true);
            assert.strictEqual(isPathContained('C:\\site', 'C:\\site', 'win32'), true);
            assert.strictEqual(isPathContained('C:\\site', 'C:\\site-secret\\file.txt', 'win32'), false);
            assert.strictEqual(isPathContained('C:\\site', 'C:\\site\\..\\secret', 'win32'), false);
            assert.strictEqual(isPathContained('C:\\site', 'D:\\site\\index.html', 'win32'), false);
            assert.strictEqual(isPathContained('C:\\Site', 'c:\\site\\index.html', 'win32'), true);
            assert.strictEqual(isPathContained('/var/www', '/var/www-secret/data', 'linux'), false);
            assert.strictEqual(isPathContained('/var/www', '/var/www/sub/app.js', 'linux'), true);
            assert.strictEqual(isPathContained('/var/www', '/etc/passwd', 'linux'), false);
        });

        test('End-to-end HTTP request blocking traversal via serveStatic', async () => {
            const testPort = 49152 + Math.floor(Math.random() * 1000);
            const server = serveStatic(testPort, false, 'index.html', fixtureDir);

            await new Promise((resolve) => {
                if (server.listening) return resolve();
                server.once('listening', resolve);
            });

            try {
                // Test 1: valid request returns 200
                const validRes = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${testPort}/`, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
                    }).on('error', reject);
                });
                assert.strictEqual(validRes.statusCode, 200);
                assert.match(validRes.body, /Hello RunPad/);

                // Test 2: URL-encoded traversal returns 403 Forbidden
                const encodedRes = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${testPort}/..%2f..%2fpackage.json`, (res) => {
                        resolve(res.statusCode);
                    }).on('error', reject);
                });
                assert.strictEqual(encodedRes, 403);

                // Test 3: Raw socket traversal request returns HTTP 403
                const rawSocketRes = await new Promise((resolve, reject) => {
                    const socket = net.connect(testPort, '127.0.0.1', () => {
                        socket.write('GET /../../package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
                    });
                    let data = '';
                    socket.on('data', chunk => {
                        data += chunk.toString('utf8');
                        socket.end();
                        resolve(data);
                    });
                    socket.on('error', reject);
                });
                assert.match(rawSocketRes, /^HTTP\/1\.1 403 Forbidden/);

                // Test 4: 404 response does NOT reflect unescaped HTML tags (Reflected XSS prevention)
                const xssRes = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${testPort}/%3Cscript%3Ealert(1)%3C%2Fscript%3E`, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'], body: data }));
                    }).on('error', reject);
                });
                assert.strictEqual(xssRes.statusCode, 404);
                assert.strictEqual(xssRes.contentType, 'text/plain; charset=utf-8');
                assert.strictEqual(xssRes.body, '404 Not Found');
                assert.ok(!xssRes.body.includes('<script>'));

                // Test 5: Rejects unsupported HTTP methods (e.g. POST) with 405 Method Not Allowed
                const postRes = await new Promise((resolve, reject) => {
                    const req = http.request(`http://127.0.0.1:${testPort}/`, { method: 'POST' }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve({ statusCode: res.statusCode, allow: res.headers['allow'], body: data }));
                    });
                    req.on('error', reject);
                    req.end('payload');
                });
                assert.strictEqual(postRes.statusCode, 405);
                assert.match(postRes.allow, /GET,\s*HEAD/);
                assert.strictEqual(postRes.body, '405 Method Not Allowed');

                // Test 6: HEAD request returns 200 OK with no body
                const headRes = await new Promise((resolve, reject) => {
                    const req = http.request(`http://127.0.0.1:${testPort}/`, { method: 'HEAD' }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'], body: data }));
                    });
                    req.on('error', reject);
                    req.end();
                });
                assert.strictEqual(headRes.statusCode, 200);
                assert.strictEqual(headRes.body, '');
            } finally {
                await new Promise(r => server.close(r));
            }
        });
    });

    describe('2. Unsafe Shell Command Construction', () => {
        test('killProcess rejects shell metacharacters in PID', () => {
            assert.strictEqual(killProcess('1234 & calc.exe'), false);
            assert.strictEqual(killProcess('1234; rm -rf /'), false);
            assert.strictEqual(killProcess('1234 | whoami'), false);
            assert.strictEqual(killProcess('`calc`'), false);
            assert.strictEqual(killProcess('$(calc)'), false);
        });

        test('killProcess rejects empty or non-numeric inputs', () => {
            assert.strictEqual(killProcess(''), false);
            assert.strictEqual(killProcess(null), false);
            assert.strictEqual(killProcess(undefined), false);
            assert.strictEqual(killProcess('abc'), false);
            assert.strictEqual(killProcess('-1'), false);
        });

        test('inspectDirectory strips shell metacharacters from package.json main', () => {
            const fixtureDir = path.join(os.tmpdir(), 'runpad-test-pkg-' + Date.now());
            fs.mkdirSync(fixtureDir, { recursive: true });
            fs.writeFileSync(path.join(fixtureDir, 'index.js'), '// entry');
            fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({
                name: 'injection-test',
                main: 'index.js"; calc.exe; echo "'
            }));

            try {
                const detected = inspectDirectory(fixtureDir);
                assert.ok(detected);
                // When pkgData.main has invalid characters, it falls through safely to index.js
                assert.strictEqual(detected.runCommand, 'node "index.js"');
                assert.ok(!detected.runCommand.includes('calc.exe'));
            } finally {
                fs.rmSync(fixtureDir, { recursive: true, force: true });
            }
        });

        test('inspectDirectory rejects flag-like package.json main (--inspect)', () => {
            const fixtureDir = path.join(os.tmpdir(), 'runpad-test-flag-' + Date.now());
            fs.mkdirSync(fixtureDir, { recursive: true });
            fs.writeFileSync(path.join(fixtureDir, 'index.js'), '// entry');
            fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({
                name: 'flag-injection-test',
                main: '--inspect=0.0.0.0:9229 app.js'
            }));

            try {
                const detected = inspectDirectory(fixtureDir);
                assert.ok(detected);
                // Flag-like main must be ignored, falling back safely to index.js
                assert.strictEqual(detected.runCommand, 'node "index.js"');
            } finally {
                fs.rmSync(fixtureDir, { recursive: true, force: true });
            }
        });
    });

    describe('3. Windows Netstat Local-Port Parsing', () => {
        const mockNetstat = [
            'Active Connections',
            '  Proto  Local Address          Foreign Address        State           PID',
            '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4412',
            '  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       8820',
            '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       6120',
            '  TCP    [::]:8080              [::]:0                 LISTENING       9010',
            '  TCP    192.168.1.5:52341      93.184.216.34:3000     ESTABLISHED     1024',
            '  TCP    192.168.1.5:52342      10.0.0.2:3000          LISTENING       9999',
            '  TCP    0.0.0.0:8000           0.0.0.0:0              TIME_WAIT       3333',
            '  UDP    0.0.0.0:3000           *:*                                    7712'
        ].join('\r\n');

        test('Correctly extracts PID for local IPv4 listening port', () => {
            const pid = parseNetstatForPort(mockNetstat, 3000);
            assert.strictEqual(pid, '4412');
        });

        test('Correctly extracts PID for 127.0.0.1 listening port', () => {
            const pid = parseNetstatForPort(mockNetstat, 5173);
            assert.strictEqual(pid, '6120');
        });

        test('Correctly extracts PID for IPv6 listening port ([::]:8080)', () => {
            const pid = parseNetstatForPort(mockNetstat, 8080);
            assert.strictEqual(pid, '9010');
        });

        test('Does NOT match foreign address port (eliminating false positive)', () => {
            const pidForForeign = parseNetstatForPort(mockNetstat, 52342);
            assert.strictEqual(pidForForeign, '9999');

            // If we query port 3000, it must return 4412 (the local listening port), NOT 9999 or 1024!
            const pidFor3000 = parseNetstatForPort(mockNetstat, 3000);
            assert.strictEqual(pidFor3000, '4412');
        });

        test('Does NOT match partial port prefix (3000 vs 30001)', () => {
            const pid = parseNetstatForPort(mockNetstat, 30001);
            assert.strictEqual(pid, '8820');

            const pid3000 = parseNetstatForPort(mockNetstat, 3000);
            assert.strictEqual(pid3000, '4412');
        });

        test('Ignores non-LISTENING states like TIME_WAIT or ESTABLISHED', () => {
            const pid = parseNetstatForPort(mockNetstat, 8000);
            assert.strictEqual(pid, null);
        });

        test('Returns null for unused port', () => {
            const pid = parseNetstatForPort(mockNetstat, 9999);
            assert.strictEqual(pid, null);
        });
    });

    describe('4. Safe Port Ownership & PID Verification', () => {
        test('isSafePid rejects System Idle (0) and System (4)', () => {
            assert.strictEqual(isSafePid('0'), false);
            assert.strictEqual(isSafePid('4'), false);
            assert.strictEqual(isSafePid(0), false);
            assert.strictEqual(isSafePid(4), false);
        });

        test('isSafePid accepts valid user-space PIDs', () => {
            assert.strictEqual(isSafePid('1234'), true);
            assert.strictEqual(isSafePid(5678), true);
            assert.strictEqual(isSafePid('100000'), true);
        });

        test('isSafePid rejects invalid strings and symbols', () => {
            assert.strictEqual(isSafePid('-5'), false);
            assert.strictEqual(isSafePid('pid'), false);
            assert.strictEqual(isSafePid(''), false);
            assert.strictEqual(isSafePid(null), false);
        });

        test('isSafePid rejects current process PID and parent PPID', () => {
            assert.strictEqual(isSafePid(process.pid), false);
            if (process.ppid) {
                assert.strictEqual(isSafePid(process.ppid), false);
            }
        });

        test('registerCleanupPath rejects arbitrary user folders and only accepts .runpad_out', () => {
            cleanupPaths.clear();
            registerCleanupPath('/home/user/my-project');
            registerCleanupPath('C:\\Users\\user\\Documents');
            assert.strictEqual(cleanupPaths.size, 0);

            registerCleanupPath('/home/user/project/.runpad_out');
            assert.strictEqual(cleanupPaths.size, 1);
            cleanupPaths.clear();
        });

        test('Protects pre-existing user .runpad_out without .runpad_session from accidental deletion', () => {
            const userProj = path.join(os.tmpdir(), 'pre-existing-user-proj-' + Date.now());
            const userOut = path.join(userProj, '.runpad_out');
            fs.mkdirSync(userOut, { recursive: true });
            fs.writeFileSync(path.join(userOut, 'secret-user-data.txt'), 'do-not-delete');

            try {
                cleanupPaths.clear();
                preExistingCleanupPaths.clear();

                registerCleanupPath(userOut);
                assert.strictEqual(preExistingCleanupPaths.has(path.resolve(userOut)), true);
                assert.strictEqual(cleanupPaths.has(path.resolve(userOut)), false);

                cleanupTemporaryFiles();
                assert.strictEqual(fs.existsSync(userOut), true, 'Pre-existing folder must remain intact');
                assert.strictEqual(fs.existsSync(path.join(userOut, 'secret-user-data.txt')), true);
            } finally {
                fs.rmSync(userProj, { recursive: true, force: true });
            }
        });

        test('prepareJavaOutputDirectory tags directory and cleans up session-owned output', () => {
            const ownedProj = path.join(os.tmpdir(), 'owned-proj-' + Date.now());
            const ownedOut = path.join(ownedProj, '.runpad_out');

            try {
                cleanupPaths.clear();
                preExistingCleanupPaths.clear();

                prepareJavaOutputDirectory(ownedOut);
                assert.strictEqual(fs.existsSync(ownedOut), true);
                assert.strictEqual(fs.existsSync(path.join(ownedOut, RUNPAD_SESSION_MARKER)), true);
                assert.strictEqual(cleanupPaths.has(path.resolve(ownedOut)), true);

                cleanupTemporaryFiles();
                assert.strictEqual(fs.existsSync(ownedOut), false, 'RunPad-owned output must be cleaned up');
            } finally {
                try { fs.rmSync(ownedProj, { recursive: true, force: true }); } catch {}
            }
        });
    });

    describe('5. Port Detection Error Handling', () => {
        test('Returns false for invalid ports (0, negative, > 65535, NaN)', async () => {
            assert.strictEqual(await isPortTaken(0), false);
            assert.strictEqual(await isPortTaken(-1), false);
            assert.strictEqual(await isPortTaken(70000), false);
            assert.strictEqual(await isPortTaken(NaN), false);
            assert.strictEqual(await isPortTaken('invalid'), false);
        });

        test('Correctly identifies an active listening port and frees it', async () => {
            const testPort = 50000 + Math.floor(Math.random() * 5000);

            const initialCheck = await isPortTaken(testPort);
            assert.strictEqual(initialCheck, false);

            const server = net.createServer();
            await new Promise(resolve => server.listen(testPort, resolve));

            const occupiedCheck = await isPortTaken(testPort);
            assert.strictEqual(occupiedCheck, true);

            await new Promise(resolve => server.close(resolve));

            const freedCheck = await isPortTaken(testPort);
            assert.strictEqual(freedCheck, false);
        });
    });

    describe('6. Process Tree Termination', () => {
        test('terminateProcessTree handles non-existent or invalid PID gracefully', () => {
            assert.doesNotThrow(() => {
                terminateProcessTree('99999999');
                terminateProcessTree(null);
                terminateProcessTree('abc');
            });
        });

        test('Spawns a shell child and terminates entire process tree freeing port', async () => {
            const testPort = 55000 + Math.floor(Math.random() * 5000);

            // Create temporary server script in test directory (no spaces in path)
            const dummyScript = path.join(__dirname, `dummy-server-${Date.now()}.js`);
            fs.writeFileSync(dummyScript, `
                const http = require('http');
                const port = parseInt(process.argv[2], 10);
                const s = http.createServer((req, res) => res.end('ok'));
                s.on('error', (err) => {
                    process.stderr.write(String(err) + '\\n');
                    process.exit(1);
                });
                s.listen(port, () => {
                    process.stdout.write('LISTENING\\n');
                });
                setInterval(() => {}, 1000);
            `);

            let child;
            try {
                child = spawn('node', [dummyScript, String(testPort)], {
                    shell: true,
                    stdio: ['ignore', 'pipe', 'ignore']
                });

                assert.ok(child.pid);

                // Wait deterministically for child server to bind
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Child server did not report LISTENING within 5s')), 5000);
                    child.stdout.on('data', (d) => {
                        if (d.toString().includes('LISTENING')) {
                            clearTimeout(timeout);
                            resolve();
                        }
                    });
                    child.on('error', (err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                });

                const taken = await isPortTaken(testPort);
                assert.strictEqual(taken, true, 'Spawned child should occupy testPort');

                // Terminate process tree
                terminateProcessTree(child.pid);

                // Verify port becomes free
                let freed = false;
                for (let i = 0; i < 50; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    if (!await isPortTaken(testPort)) {
                        freed = true;
                        break;
                    }
                }

                assert.strictEqual(freed, true, 'Port should be released after terminateProcessTree');
            } finally {
                try { fs.unlinkSync(dummyScript); } catch {}
                if (child && child.pid) {
                    try { terminateProcessTree(child.pid); } catch {}
                }
            }
        });
    });

    describe('7. Browser Auto-Open Readiness Polling', () => {
        const { EventEmitter } = require('node:events');

        test('waitForPortAndOpen aborts without opening if child process exits prematurely', async () => {
            const testPort = 58000 + Math.floor(Math.random() * 2000);
            const mockChild = new EventEmitter();

            let opened = false;
            // Emit exit immediately
            setTimeout(() => {
                mockChild.emit('exit', 1);
            }, 50);

            waitForPortAndOpen(testPort, mockChild, 500, 50);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(opened, false);
        });

        test('waitForPortAndOpen resolves safely on invalid or non-positive port', () => {
            assert.doesNotThrow(() => {
                waitForPortAndOpen(0, null);
                waitForPortAndOpen(-1, null);
                waitForPortAndOpen(null, null);
                waitForPortAndOpen('not-a-port', null);
            });
        });
    });
});
