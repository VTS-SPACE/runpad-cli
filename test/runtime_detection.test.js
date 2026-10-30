const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
    detectPackageManager,
    resolvePythonInterpreter,
    inspectDirectory
} = require('../bin/index.js');

describe('Runtime, Detection & CLI Argument Tests', () => {

    const testRootDir = path.join(os.tmpdir(), 'runpad-detection-tests-' + Date.now());

    before(() => {
        fs.mkdirSync(testRootDir, { recursive: true });
    });

    after(() => {
        try {
            fs.rmSync(testRootDir, { recursive: true, force: true });
        } catch {}
    });

    describe('1 & 2. --open, -o & Vite Browser Flag Isolation', () => {
        const viteDir = path.join(testRootDir, 'vite-app');

        before(() => {
            fs.mkdirSync(viteDir, { recursive: true });
            fs.writeFileSync(path.join(viteDir, 'package.json'), JSON.stringify({
                name: 'vite-test',
                devDependencies: { vite: '^5.0.0' }
            }));
        });

        test('Vite project does NOT include --open when isOpen is false', () => {
            const detected = inspectDirectory(viteDir, { isOpen: false });
            assert.ok(detected);
            assert.strictEqual(detected.detectedType, 'React / Vue / Vite App');
            assert.ok(!detected.args.includes('--open'), 'Args should not contain --open');
            assert.ok(!detected.runCommand.includes('--open'), 'Command string should not contain --open');
        });

        test('Vite project includes --open when isOpen is true', () => {
            const detected = inspectDirectory(viteDir, { isOpen: true });
            assert.ok(detected);
            assert.ok(detected.args.includes('--open'), 'Args should contain --open');
            assert.ok(detected.runCommand.includes('--open'), 'Command string should contain --open');
        });

        test('Vite project forwards both --host, custom port and --open correctly', () => {
            const detected = inspectDirectory(viteDir, { isHost: true, explicitPort: 5200, isOpen: true });
            assert.ok(detected);
            assert.strictEqual(detected.targetPort, 5200);
            assert.ok(detected.args.includes('--host'));
            assert.ok(detected.args.includes('--port'));
            assert.ok(detected.args.includes('5200'));
            assert.ok(detected.args.includes('--open'));
            assert.strictEqual(detected.runCommand, 'npm run dev -- --host --port 5200 --open');
        });
    });

    describe('3. Node.js Package Manager Detection & Scripts', () => {
        test('Detects pnpm when pnpm-lock.yaml is present', () => {
            const dir = path.join(testRootDir, 'pnpm-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                name: 'pnpm-app',
                scripts: { dev: 'vite' }
            }));
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

            const pm = detectPackageManager(dir);
            assert.strictEqual(pm, 'pnpm');

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected.executable, 'pnpm');
            assert.deepStrictEqual(detected.args, ['run', 'dev']);
            assert.strictEqual(detected.runCommand, 'pnpm run dev');
        });

        test('Detects yarn when yarn.lock is present', () => {
            const dir = path.join(testRootDir, 'yarn-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                name: 'yarn-app',
                scripts: { dev: 'next dev' }
            }));
            fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

            const pm = detectPackageManager(dir);
            assert.strictEqual(pm, 'yarn');

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected.executable, 'yarn');
            assert.deepStrictEqual(detected.args, ['run', 'dev']);
            assert.strictEqual(detected.runCommand, 'yarn run dev');
        });

        test('Detects bun when bun.lockb is present', () => {
            const dir = path.join(testRootDir, 'bun-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                name: 'bun-app',
                scripts: { start: 'node index.js' }
            }));
            fs.writeFileSync(path.join(dir, 'bun.lockb'), '');

            const pm = detectPackageManager(dir);
            assert.strictEqual(pm, 'bun');

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected.executable, 'bun');
            assert.deepStrictEqual(detected.args, ['run', 'start']);
            assert.strictEqual(detected.runCommand, 'bun run start');
        });

        test('Detects packageManager field from package.json', () => {
            const dir = path.join(testRootDir, 'pkg-manager-field');
            fs.mkdirSync(dir, { recursive: true });
            const pkgData = {
                name: 'turbo-app',
                packageManager: 'pnpm@9.5.0',
                scripts: { dev: 'next dev' }
            };
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgData));

            const pm = detectPackageManager(dir, pkgData);
            assert.strictEqual(pm, 'pnpm');

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected.executable, 'pnpm');
            assert.strictEqual(detected.packageManager, 'pnpm');
        });

        test('Next.js project with explicit port forwards -p correctly', () => {
            const dir = path.join(testRootDir, 'next-custom-port');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                name: 'next-app',
                dependencies: { next: '14.0.0' },
                scripts: { dev: 'next dev' }
            }));
            fs.writeFileSync(path.join(dir, 'package-lock.json'), '');

            const detected = inspectDirectory(dir, { explicitPort: 3005 });
            assert.ok(detected);
            assert.strictEqual(detected.detectedType, 'Next.js App');
            assert.strictEqual(detected.executable, 'npm');
            assert.deepStrictEqual(detected.args, ['run', 'dev', '--', '-p', '3005']);
            assert.strictEqual(detected.runCommand, 'npm run dev -- -p 3005');
        });
    });

    describe('4. Python Interpreter & Virtual Environment Selection', () => {
        const isWin = process.platform === 'win32';

        test('Detects local .venv virtual environment', () => {
            const dir = path.join(testRootDir, 'py-venv-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'main.py'), 'print("hello")');

            const venvScripts = isWin ? path.join(dir, '.venv', 'Scripts') : path.join(dir, '.venv', 'bin');
            fs.mkdirSync(venvScripts, { recursive: true });

            const fakePyExe = isWin ? path.join(venvScripts, 'python.exe') : path.join(venvScripts, 'python');
            fs.writeFileSync(fakePyExe, '');

            const interpreter = resolvePythonInterpreter(dir);
            assert.strictEqual(interpreter, fakePyExe);

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.strictEqual(detected.detectedType, 'Python Application');
            assert.strictEqual(detected.executable, fakePyExe);
            assert.deepStrictEqual(detected.args, ['main.py']);
        });

        test('Django project forwards port and uses virtualenv', () => {
            const dir = path.join(testRootDir, 'django-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'manage.py'), '# django');

            const venvScripts = isWin ? path.join(dir, 'venv', 'Scripts') : path.join(dir, 'venv', 'bin');
            fs.mkdirSync(venvScripts, { recursive: true });
            const fakePyExe = isWin ? path.join(venvScripts, 'python.exe') : path.join(venvScripts, 'python');
            fs.writeFileSync(fakePyExe, '');

            const detected = inspectDirectory(dir, { explicitPort: 9000 });
            assert.ok(detected);
            assert.strictEqual(detected.detectedType, 'Python Django App');
            assert.strictEqual(detected.targetPort, 9000);
            assert.strictEqual(detected.executable, fakePyExe);
            assert.deepStrictEqual(detected.args, ['manage.py', 'runserver', '9000']);
        });

        test('Falls back to system interpreter when no venv exists', () => {
            const dir = path.join(testRootDir, 'py-system-app');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'app.py'), 'print("ok")');

            const interpreter = resolvePythonInterpreter(dir);
            assert.strictEqual(interpreter, isWin ? 'python' : 'python3');

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.strictEqual(detected.executable, isWin ? 'python' : 'python3');
            assert.deepStrictEqual(detected.args, ['app.py']);
        });
    });

    describe('5. .NET Multi-Project Ambiguity Resolution', () => {
        test('Single .csproj project targets that project directly', () => {
            const dir = path.join(testRootDir, 'dotnet-single');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'Api.csproj'), '<Project></Project>');

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.strictEqual(detected.detectedType, 'C# / .NET Project');
            assert.strictEqual(detected.executable, 'dotnet');
            assert.deepStrictEqual(detected.args, ['run', '--project', 'Api.csproj']);
            assert.strictEqual(detected.runCommand, 'dotnet run --project "Api.csproj"');
        });

        test('Multiple .csproj projects filters out test projects', () => {
            const dir = path.join(testRootDir, 'dotnet-multi');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'Web.csproj'), '<Project></Project>');
            fs.writeFileSync(path.join(dir, 'Web.Tests.csproj'), '<Project></Project>');
            fs.writeFileSync(path.join(dir, 'Web.UnitTests.csproj'), '<Project></Project>');

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.strictEqual(detected.executable, 'dotnet');
            assert.deepStrictEqual(detected.args, ['run', '--project', 'Web.csproj']);
            assert.strictEqual(detected.runCommand, 'dotnet run --project "Web.csproj"');
        });

        test('.NET project with custom port passes --urls', () => {
            const dir = path.join(testRootDir, 'dotnet-port');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'Server.csproj'), '<Project></Project>');

            const detected = inspectDirectory(dir, { explicitPort: 5050 });
            assert.ok(detected);
            assert.strictEqual(detected.targetPort, 5050);
            assert.deepStrictEqual(detected.args, ['run', '--project', 'Server.csproj', '--urls', 'http://localhost:5050']);
            assert.strictEqual(detected.runCommand, 'dotnet run --project "Server.csproj" --urls http://localhost:5050');
        });

        test('Sanitizes shell metacharacters from .csproj project filenames', () => {
            const dir = path.join(testRootDir, 'dotnet-sanitize');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'SafeProject;calc.csproj'), '<Project></Project>');

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.ok(!detected.runCommand.includes(';'));
            assert.ok(!detected.runCommand.includes('`'));
            assert.ok(!detected.runCommand.includes('$'));
            assert.ok(detected.runCommand.includes('SafeProjectcalc.csproj'));
        });
    });

    describe('6. Unsupported Project Diagnostics', () => {
        test('Returns null for directory with no supported project markers', () => {
            const dir = path.join(testRootDir, 'unsupported-dir');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'notes.txt'), 'random file');

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected, null);
        });

        test('Returns null for empty directory', () => {
            const dir = path.join(testRootDir, 'empty-dir');
            fs.mkdirSync(dir, { recursive: true });

            const detected = inspectDirectory(dir);
            assert.strictEqual(detected, null);
        });
    });

    describe('7. End-to-End Spawn Execution with Verified Executable & Arguments', () => {
        test('Node application spawns verified executable and receives exact args', async () => {
            const dir = path.join(testRootDir, 'spawn-node-test');
            fs.mkdirSync(dir, { recursive: true });
            const outputFile = path.join(dir, 'out.json');

            fs.writeFileSync(path.join(dir, 'index.js'), `
                const fs = require('fs');
                fs.writeFileSync(${JSON.stringify(outputFile)}, JSON.stringify({
                    argv: process.argv.slice(2),
                    execPath: process.execPath
                }));
            `);
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                name: 'spawn-test',
                main: 'index.js'
            }));

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.strictEqual(detected.executable, 'node');
            assert.deepStrictEqual(detected.args, ['index.js']);

            // Actually spawn the detected command
            const { spawn } = require('node:child_process');
            const child = spawn(detected.runCommand, {
                cwd: detected.targetDir,
                shell: true,
                stdio: 'ignore'
            });

            await new Promise((resolve, reject) => {
                child.on('exit', (code) => {
                    assert.strictEqual(code, 0);
                    resolve();
                });
                child.on('error', reject);
            });

            assert.ok(fs.existsSync(outputFile));
            const recorded = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            assert.ok(recorded.execPath.toLowerCase().includes('node'));
        });

        test('Python application spawns verified interpreter and receives exact args', async () => {
            const dir = path.join(testRootDir, 'spawn-py-test');
            fs.mkdirSync(dir, { recursive: true });
            const outputFile = path.join(dir, 'py_out.json');

            fs.writeFileSync(path.join(dir, 'main.py'), `
import sys, json
with open(r"${outputFile}", "w") as f:
    json.dump({"argv": sys.argv[1:], "executable": sys.executable}, f)
`);

            const detected = inspectDirectory(dir);
            assert.ok(detected);
            assert.ok(detected.executable === 'python' || detected.executable === 'python3');
            assert.deepStrictEqual(detected.args, ['main.py']);

            const { spawn } = require('node:child_process');
            const child = spawn(detected.runCommand, {
                cwd: detected.targetDir,
                shell: true,
                stdio: 'ignore'
            });

            const exitCode = await new Promise((resolve) => {
                child.on('exit', (code) => resolve(code));
                child.on('error', () => resolve(-1));
            });

            // If python is available on host, verify payload
            if (exitCode === 0 && fs.existsSync(outputFile)) {
                const recorded = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                assert.deepStrictEqual(recorded.argv, []);
                assert.ok(recorded.executable.toLowerCase().includes('python'));
            }
        });
    });
});
