# ⚡ RunPad

**Universal Dev Runner & Port Sentinel**

*One zero-dependency command to detect stacks, resolve port locks, and run servers.*

[![npm version](https://img.shields.io/npm/v/runpad-cli?style=flat-square)](https://www.npmjs.com/package/runpad-cli)
[![npm downloads](https://img.shields.io/npm/dm/runpad-cli?style=flat-square)](https://www.npmjs.com/package/runpad-cli)
[![License](https://img.shields.io/github/license/VTS-SPACE/runpad-cli?style=flat-square)](https://github.com/VTS-SPACE/runpad-cli/blob/main/LICENSE)

```bash
npx runpad-cli
```

---

## The Problem

```text
Error: listen EADDRINUSE: address already in use :::5173
```

Every developer encounters this daily:

1. Open Task Manager or Activity Monitor.
2. Run obscure `netstat -ano | findstr :5173` or `lsof -i :5173` commands.
3. Manually kill the PID.
4. Re-run `npm run dev`.

## The RunPad Solution

RunPad inspects your workspace, detects your framework, tests the target port, terminates zombie processes upon confirmation, and boots your development server in under **50 milliseconds**.

---

## ⚡ Quick Start

### 1. Instant Execution (Zero Install)

Run directly inside any repository without adding local files:

```bash
npx runpad-cli
```

### 2. Permanent Global CLI (Recommended)

Install once to unlock the `runpad` terminal command across your machine:

```bash
npm install -g runpad-cli
```

---

## 🕹️ Command Reference

| Command | Action | Example |
| :--- | :--- | :--- |
| `runpad` | Auto-detect stack, check target port, and launch dev server | `runpad` |
| `runpad kill <port>` | Forcefully terminates the process tree locking a port | `runpad kill 5173` |
| `runpad ports` | Live audit of common development ports and active PIDs | `runpad ports` |
| `runpad -o`, `--open` | Automatically launches your default browser | `runpad -o` |
| `runpad -h`, `--host` | Exposes dev server to your local network / Wi-Fi | `runpad -h` |
| `runpad -p <number>` | Overrides default port with custom port assignment | `runpad -p 8080` |
| `runpad --help` | Displays CLI documentation and options | `runpad --help` |
| `runpad -v`, `--version` | Prints installed version | `runpad -v` |

---

## 🚀 Key Features

### 1. Pre-flight Port Sentinel

When you trigger `runpad`, it checks whether the project port is occupied before invoking child processes. If a collision is caught, it offers single-key resolution:

```text
⚡ RunPad Engine v0.1.0 — Scanning workspace...
📂 Directory: C:\Projects\WebStore
🔍 Detected: React / Vue / Vite App
⚠️ Port Conflict: Port 5173 is currently locked by PID 14220.
👉 Kill PID 14220 to free port 5173? (Y/n): y
⏳ Freeing port 5173...
✔ Port 5173 is released and ready!
🚀 Command: npm run dev -- --open
```

### 2. Standalone Port Execution

Free any port without opening external monitors or shell tools:

```bash
runpad kill 5173
```

```text
⏳ Terminating process tree for PID 14220 on port 5173...
✔ Successfully freed port 5173! (Terminated PID 14220)
🚀
```

### 3. Active Port Audit

Check all common local development ports simultaneously:

```bash
runpad ports
```

```text
⚡ RunPad Sentinel — Active Port Audit:
Port 3000 : FREE
Port 3001 : FREE
Port 4200 : FREE
Port 5000 : FREE
Port 5173 : BUSY (PID: 14220)
──► runpad kill 5173
Port 8000 : FREE
Port 8080 : BUSY (PID: 9804)
──► runpad kill 8080
Port 8888 : FREE
```

### 4. Built-in Static Web Server

If an `index.html` file is detected without Node or build tooling, RunPad serves it instantly using a built-in native HTTP server:

```bash
runpad --open
```

```text
✔ Built-in Web Server live at: http://localhost:3000
```

---

## 🔍 Supported Frameworks & Detection Matrix

RunPad detects project markers and maps runtime execution automatically:

| Framework / Stack | Marker | Default Port | Command Executed |
| :--- | :--- | :--- | :--- |
| **Vite (React / Vue / Svelte)** | `package.json` (`vite`) | `5173` | `npm run dev -- --open` |
| **Next.js** | `package.json` (`next`) | `3000` | `npm run dev` |
| **NestJS Backend** | `package.json` (`@nestjs/core`) | `3000` | `npm run start:dev` |
| **Node.js / Express** | `package.json` | `3000` | `npm run dev` / `npm start` |
| **Java Spring Boot (Maven)** | `pom.xml` | `8080` | `./mvnw spring-boot:run` |
| **Java Spring Boot (Gradle)** | `build.gradle` | `8080` | `./gradlew bootRun` |
| **C# / .NET Core** | `*.csproj`, `*.sln` | `5000` | `dotnet run` |
| **Python (Django)** | `manage.py` | `8000` | `python manage.py runserver` |
| **Python (FastAPI / Flask)** | `main.py`, `app.py` | `8000` | `python main.py` |
| **Static HTML / CSS / JS** | `index.html` | `3000` | *Built-in Native Web Server* |

---

## 🛡️ Architecture & Cross-Platform Engine

RunPad carries **zero third-party dependencies**. It utilizes native Node.js core modules (`net`, `http`, `child_process`, and `fs`) to maintain a lightweight footprint:

* **Windows:** Employs `netstat -ano` regular-expression inspection and recursive tree kills via `taskkill /F /T /PID <pid>`.
* **macOS & Linux:** Employs POSIX socket lookups via `lsof -ti :<port>` and hard termination via `kill -9 <pid>`.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

Engineered by **VTS SPACE**.
