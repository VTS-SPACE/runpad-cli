# ⚡ RunPad CLI

**One command. Your project, running.**

A lightweight, zero-dependency developer CLI that detects your framework, manages port conflicts, and launches your development environment without memorizing startup commands.

[![npm version](https://img.shields.io/npm/v/runpad-cli?style=flat-square)](https://www.npmjs.com/package/runpad-cli)
[![Node.js version](https://img.shields.io/node/v/runpad-cli?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success?style=flat-square)](package.json)

```bash
npx runpad-cli
```

---

## Table of Contents

- [What Is RunPad CLI?](#what-is-runpad-cli)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands and Options](#commands-and-options)
- [Supported Runtimes and Frameworks](#supported-runtimes-and-frameworks)
- [Project Detection Precedence](#project-detection-precedence)
- [Usage Examples](#usage-examples)
- [Port Management and Sentinel](#port-management-and-sentinel)
- [Browser Auto-Opening](#browser-auto-opening)
- [Java Setup and Execution](#java-setup-and-execution)
- [Python Setup and Execution](#python-setup-and-execution)
- [Configuration and Overrides](#configuration-and-overrides)
- [Security and Process Safety](#security-and-process-safety)
- [Troubleshooting](#troubleshooting)
- [Development and Testing](#development-and-testing)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## What Is RunPad CLI?

Modern developers switch constantly between different languages, frameworks, and tools: Vite, Next.js, Django, FastAPI, Spring Boot, Maven, Gradle, .NET, or static HTML. Each ecosystem requires distinct start commands, specific wrapper scripts (`mvnw.cmd` vs `./mvnw`, `gradlew.bat` vs `./gradlew`), or custom virtual environments (`.venv/Scripts/python.exe` vs `python3`).

To make matters worse, background servers frequently hold onto local ports (`3000`, `5173`, `8080`), triggering confusing `EADDRINUSE` errors that interrupt your workflow.

**RunPad CLI** solves this by acting as a universal project runner and pre-flight port sentinel:

1. **Inspects your directory:** Discovers project manifests, package managers, and entry points.
2. **Checks target ports:** Detects whether required local ports are already in use before spawning processes.
3. **Resolves conflicts:** Offers one-key interactive termination of orphan processes while safeguarding critical system processes.
4. **Boots the project:** Launches the appropriate runtime command with proper wrappers, virtual environments, and arguments.

### What RunPad CLI Is NOT

- **Not a package manager:** RunPad does not replace `npm`, `pnpm`, `yarn`, `bun`, `pip`, or `cargo`. Dependencies must be installed beforehand.
- **Not a compiler or build system:** RunPad orchestrates your installed toolchain (`node`, `python`, `javac`, `dotnet`, `mvn`); it does not bundle its own compiler binaries.
- **Not a deployment orchestrator or sandbox:** RunPad is intended for local developer machines during day-to-day coding.

---

## Key Features

- **Automatic Project Detection:** Identifies Node.js (Vite, Next.js, NestJS, Express), Python (Django, FastAPI, Flask), Java (Maven, Gradle, standalone sources), .NET, and static HTML sites.
- **Pre-Flight Port Sentinel:** Scans target ports before launching. If a port is occupied, RunPad displays the process name and PID and offers safe termination.
- **Dedicated Port Utilities:** Standalone `runpad kill <port>` and `runpad ports` audit commands simplify port management without task managers.
- **Zero Third-Party Dependencies:** Implemented strictly with native Node.js core modules (`http`, `net`, `child_process`, `fs`, `path`).
- **Safe Process Lifecycle Management:** Cleanly terminates entire child process trees on `Ctrl+C` (`SIGINT`/`SIGTERM`) across Windows (`taskkill /F /T`) and POSIX systems (`SIGTERM`).
- **Secure Built-in Web Server:** Serves static websites with strict directory containment, traversal rejection, double-encoding blocking, null-byte prevention, and method restrictions.
- **Multi-Service Workspace Support:** When run in a multi-service folder (e.g., separate `client/` and `server/`), RunPad discovers and launches both services concurrently.
- **Readiness-Polled Browser Opening:** When passed `--open` (`-o`), RunPad polls TCP socket connectivity before launching your browser, preventing premature dead tabs.

---

## Prerequisites

RunPad CLI requires Node.js. Additional tools are only required if your project uses that specific runtime:

| Tool / Runtime | Minimum Version | Required For | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>= 18.0.0` | RunPad CLI itself | Required on all systems |
| **npm** | `8.0.0+` | Installation / Node projects | Bundled with Node.js |
| **Java (JDK / JRE)** | `11+` | Java standalone single-file | `java` in `PATH` or `JAVA_HOME` |
| **Java JDK (`javac`)** | `11+` | Java multi-file compilation | Full JDK required; JRE alone cannot compile |
| **Maven / Gradle** | Any | Java build systems | System install optional if project includes `mvnw` or `gradlew` |
| **Python** | `3.8+` | Python applications | Auto-discovers `.venv`, `venv`, or system `python`/`python3` |
| **.NET SDK** | `6.0+` | C# / .NET projects | Required only if running `.csproj` or `.sln` projects |

> **Note:** You do **not** need to install Python, Java, or .NET to run Node.js or static HTML projects.

---

## Installation

### On-Demand Execution (No Installation)

Run RunPad directly in any repository using `npx`:

```bash
npx runpad-cli
```

### Global Installation (Recommended)

Install globally to make the `runpad` command available in all terminal sessions:

```bash
npm install -g runpad-cli
```

### Verify Installation

Check your installed version and verify runtime discovery:

```bash
runpad --version
```

---

## Quick Start

1. Open your terminal and navigate to your project directory:

   ```bash
   cd path/to/your-project
   ```

2. Execute `runpad`:

   ```bash
   runpad
   ```

3. RunPad scans your files, verifies port availability, and starts your project:

   ```text
   ⚡ RunPad Engine v0.1.4 — Scanning workspace...

   📂 Directory: C:\Projects\MyWebApp
   🔍 Detected: React / Vue / Vite App (pnpm)
   🚀 Command: pnpm run dev
   ```

4. To stop the running server, press **`Ctrl + C`**. RunPad traps the shutdown signal and terminates the spawned process tree cleanly.

---

## Commands and Options

```text
USAGE:
  $ runpad [command] [options]
```

| Command / Option | Alias | Description | Example |
| :--- | :--- | :--- | :--- |
| `runpad` | *(default)* | Scans current workspace, resolves port conflicts, and launches dev server | `runpad` |
| `runpad kill <port>` | — | Safely terminates the process tree occupying the specified port | `runpad kill 5173` |
| `runpad ports` | — | Performs a live audit of common development ports and active PIDs | `runpad ports` |
| `--open` | `-o` | Automatically opens default web browser upon server readiness | `runpad --open` |
| `--host` | `-h` | Forwards `--host` to expose server to Wi-Fi / local network (where supported) | `runpad --host` |
| `--port <number>` | `-p <number>` | Overrides target port check and passes port parameter to supported frameworks | `runpad -p 8080` |
| `--help` | `help` | Displays the command-line usage guide and options | `runpad --help` |
| `--version` | `-v` | Prints installed RunPad CLI version | `runpad --version` |

---

## Supported Runtimes and Frameworks

| Runtime / Project Type | Detection Criteria | Default Port | Command Executed | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **Vite (React / Vue / Svelte)** | `package.json` contains `vite` dependency or devDependency | `5173` | `<pm> run dev` *(passes `--open`, `--host` natively)* | Verified with automated tests |
| **Next.js** | `package.json` contains `next` dependency | `3000` | `<pm> run dev` *(forwards `-p <port>` if overridden)* | Verified with automated tests |
| **NestJS Backend** | `package.json` contains `@nestjs/core` | `3000` | `<pm> run start:dev` | Verified with automated tests |
| **Node.js (Generic)** | `package.json` with `scripts.dev`, `scripts.start`, or `main` | `3000` | `<pm> run dev`, `<pm> start`, or `node <main>` | Verified with automated tests |
| **Java Spring Boot (Maven)** | `pom.xml` containing `spring-boot` | `8080` | `<mvn-wrapper> spring-boot:run` | Verified with automated tests |
| **Java Spring Boot (Gradle)** | `build.gradle` / `build.gradle.kts` with `spring-boot` | `8080` | `<gradle-wrapper> bootRun` | Verified with automated tests |
| **Java Maven Application** | `pom.xml` without Spring Boot | `8080` | `<mvn-wrapper> compile exec:java` | Verified with automated tests |
| **Java Gradle Application** | `build.gradle` / `build.gradle.kts` without Spring Boot | `8080` | `<gradle-wrapper> run` | Verified with automated tests |
| **Java Standalone (Single-File)** | Single `*.java` file or source with no package statement | `8080` | `java <File.java>` | Verified with automated tests |
| **Java Standalone (Multi-File)** | Multiple `*.java` files with packages or shared classes | `8080` | `javac -d .runpad_out ... && java -cp .runpad_out <FQCN>` | Verified with automated tests |
| **Python (Django)** | `manage.py` in directory | `8000` | `<python> manage.py runserver <port>` | Verified with automated tests |
| **Python (FastAPI / Flask / App)** | `main.py`, `app.py`, or `run.py` | `8000` | `<python> <entrypoint>` | Verified with automated tests |
| **C# / .NET Project** | `*.csproj` or `*.sln` (excluding test projects) | `5000` | `dotnet run --project <project.csproj>` | Detection verified; runtime requires .NET SDK |
| **Static HTML Website** | `index.html` or `*.html` without build tooling | `3000` | Built-in Secure Static Web Server | Verified with automated tests |
| **Multi-Service Workspace** | Subfolders containing recognized services | Multi | Concurrently launches all detected services | Verified with automated tests |

---

## Project Detection Precedence

When RunPad analyzes a workspace, it evaluates detection markers in a deterministic order:

```text
1. Root Workspace Evaluation
   ├── package.json present?
   │   ├── Contains "vite"? ──► Vite Application
   │   ├── Contains "next"? ──► Next.js Application
   │   ├── Contains "@nestjs/core"? ──► NestJS Application
   │   └── Standard package.json? ──► Node.js Application (dev/start/main)
   ├── pom.xml present? ──► Maven Java Project (mvnw.cmd / ./mvnw / mvn)
   ├── build.gradle / build.gradle.kts? ──► Gradle Java Project (gradlew.bat / ./gradlew / gradle)
   ├── *.java files present?
   │   ├── Single file without package? ──► Standalone Single-File Java
   │   └── Multiple files or packages? ──► Standalone Multi-File Java (javac -> java)
   ├── *.csproj or *.sln present? ──► C# / .NET Project (dotnet run)
   ├── manage.py present? ──► Python Django Application
   ├── main.py / app.py / run.py present? ──► Python Application
   └── index.html / *.html present? ──► Built-in Static Web Server

2. Multi-Service Workspace Fallback
   └── If root has no runnable project, scan immediate subdirectories (client/, server/, etc.)
```

### Ambiguity Handling

- **Test Projects:** When inspecting `.csproj` files, projects containing `Test`, `Tests`, `xUnit`, or `NUnit` are ignored to select the primary application.
- **Java Entry Points:** In multi-file Java projects with several `main` methods, `Main.java` is preferred as the default entry point.
- **Package Managers:** RunPad checks for lockfiles in order (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`), or respects the `packageManager` declaration in `package.json`.

---

## Usage Examples

### 1. Static HTML Website

Serve plain HTML, CSS, and client-side JavaScript instantly:

```bash
cd my-landing-page
runpad --open
```

RunPad launches its built-in static server on port 3000 and opens your browser.

### 2. Node.js & Vite Applications

RunPad detects lockfiles and executes the appropriate package manager (`pnpm`, `yarn`, `bun`, or `npm`):

```bash
cd my-vite-app
runpad
```

Output:

```text
⚡ RunPad Engine v0.1.4 — Scanning workspace...

📂 Directory: C:\Projects\my-vite-app
🔍 Detected: React / Vue / Vite App (pnpm)
🚀 Command: pnpm run dev
```

### 3. Python Applications with Virtual Environments

RunPad prioritizes local virtual environments over global interpreters:

```bash
cd my-fastapi-api
runpad
```

If `.venv` or `venv` exists, RunPad executes:

```text
🚀 Command: .venv\Scripts\python.exe main.py
```

### 4. Standalone Java Applications

Run single-file Java directly without creating Maven or Gradle configurations:

```bash
cd my-java-tool
runpad
```

For single files: `java HelloWorld.java`. For multi-file applications: compiles to isolated `.runpad_out` and launches the fully qualified class name.

---

## Port Management and Sentinel

### Pre-Flight Conflict Resolution

Before launching any project that requires a local port, RunPad tests socket availability. If a collision is found:

```text
⚠️  Port Conflict: Port 5173 is currently locked by PID 14220 (node.exe).
👉 Kill PID 14220 (node.exe) to free port 5173? (Y/n):
```

- Typing **`y`** or pressing **Enter**: RunPad terminates the process tree and confirms port release before starting the new server.
- Typing **`n`**: RunPad aborts safely without crashing or launching a duplicate process.

### Protected Processes

RunPad strictly refuses to terminate protected system processes:

- **PID 0** (System Idle Process)
- **PID 4** (Windows NT Kernel & System)
- **RunPad's own PID** (`process.pid`)
- **Parent process PID** (`process.ppid`)

If a protected PID occupies a port, RunPad reports:

```text
❌ Port 80 is locked by system PID 4 (ntoskrnl.exe). RunPad will not terminate this process.
```

### Time-of-Check to Time-of-Use (TOCTOU) Protection

Before executing process termination, RunPad re-verifies that the listening process on the target port has not changed. If the process exited or another application claimed the port, termination is aborted to protect unrelated software.

### Standalone Port Commands

Free an occupied port directly:

```bash
runpad kill 5173
```

Audit common development ports (`3000`, `3001`, `4200`, `5000`, `5173`, `8000`, `8080`, `8888`):

```bash
runpad ports
```

---

## Browser Auto-Opening

When launching web projects, pass `--open` (or `-o`):

```bash
runpad --open
```

### How It Works

1. **Vite Projects:** RunPad passes `--open` directly to Vite, utilizing Vite's native browser handling.
2. **Other Frameworks & Static Server:** RunPad activates an asynchronous socket readiness poller (`waitForPortAndOpen`). It probes the target port until the server is actively accepting connections, then launches your default browser.
3. **Crash Protection:** If the child process exits or fails during startup, browser opening is immediately cancelled, preventing blank browser tabs.

---

## Java Setup and Execution

RunPad supports three primary Java project layouts:

### 1. Build Tools (Maven & Gradle)

- **Maven:** RunPad prioritizes `mvnw.cmd` (Windows) or `./mvnw` (POSIX). If no wrapper exists, it falls back to system `mvn`.
- **Gradle:** Prioritizes `gradlew.bat` (Windows) or `./gradlew` (POSIX), falling back to system `gradle`.
- **Spring Boot:** Auto-detects Spring Boot in dependencies and configures `spring-boot:run` (Maven) or `bootRun` (Gradle).

### 2. Standalone Single-File Java

Single `.java` files without package statements execute via Java 11+ single-source execution:

```text
java Application.java
```

### 3. Standalone Multi-File Java

Projects with multiple `.java` files or package statements require a full JDK compiler (`javac`):

- RunPad analyzes package statements, imports, and `public static void main` methods.
- Output classes are compiled into an isolated `.runpad_out` directory.
- A session marker file (`.runpad_session`) is created inside `.runpad_out`. Pre-existing user directories without this marker are protected from deletion.
- On process shutdown, RunPad cleans up `.runpad_out`.

---

## Python Setup and Execution

RunPad provides automatic virtual environment discovery for Python projects:

1. **Discovery Order:**
   - `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (POSIX)
   - `venv/Scripts/python.exe` (Windows) or `venv/bin/python` (POSIX)
   - System `python` or `python3`
2. **Django Support:** If `manage.py` is present, RunPad invokes `runserver` and forwards custom ports if specified (`runpad -p 8080`).
3. **Application Entry Points:** If `manage.py` is not found, RunPad searches for `main.py`, `app.py`, or `run.py`.

---

## Configuration and Overrides

RunPad requires zero configuration files. Behavior can be adjusted via CLI flags:

| Need | CLI Flag | Effect |
| :--- | :--- | :--- |
| **Change Port** | `-p <number>` or `--port <number>` | Checks availability of the custom port and passes port flags to supported frameworks |
| **Open Browser** | `-o` or `--open` | Opens browser when server port becomes live |
| **Expose to Network** | `-h` or `--host` | Forwards `--host` to Vite or local dev server |

---

## Security and Process Safety

RunPad includes explicit security defenses:

- **Static Server Path Traversal Protection:** Static file paths are resolved through canonical containment verification (`isPathContained`). Directory traversals (`../../`), Windows drive escapes, and encoded traversals (`%2e%2e%2f` and `%252e%252e%252f`) are rejected with `403 Forbidden` or `400 Bad Request`.
- **Safe Static Errors:** Server error responses return generic plain-text messages (`404 Not Found`, `403 Forbidden: Access Denied`) and never reflect unescaped user input or leak absolute server paths.
- **Null-Byte Injection Blocking:** URL paths containing `%00` or null bytes are rejected immediately with HTTP 400.
- **Allowed HTTP Methods:** The static server only accepts `GET` and `HEAD` requests. Other methods receive `405 Method Not Allowed`.
- **Command Injection Hardening:** File names, manifest main fields, class names, and arguments are sanitized to eliminate shell metacharacters (`" \` $ ; \| & < > \r \n`).
- **PID Validation:** Process termination strictly validates that target PIDs consist solely of numeric digits (`/^\d+$/`) before passing them to OS process tools.
- **Developer Trust Boundary:** Running `runpad` inside a project folder executes project code with your local user permissions (similar to running `npm run dev`). Only execute RunPad in repositories you trust.

---

## Troubleshooting

| Problem | Probable Cause | Actionable Solution |
| :--- | :--- | :--- |
| **`Error: listen EADDRINUSE`** | Background process occupies port | Run `runpad` to use the interactive sentinel, or run `runpad kill <port>` directly |
| **`JDK_REQUIRED` on Java project** | JRE installed instead of full JDK | Multi-file Java requires `javac`. Install an OpenJDK 17+ JDK and set `JAVA_HOME` |
| **`No runnable project detected`** | Missing standard project markers | Ensure your project contains standard files (`package.json`, `pom.xml`, `manage.py`, etc.) |
| **Virtual environment not used** | `.venv` folder in non-standard location | Create your virtual environment as `.venv` or `venv` in the project root |
| **`Port locked by system PID 4`** | System service (e.g., IIS, HTTP.sys) uses port | Use `-p <port>` to run your project on an alternative port (e.g. `runpad -p 3001`) |
| **Permission denied on `runpad kill`** | Target process owned by another user | Run terminal as Administrator or terminate the process via Task Manager |
| **Browser does not open with `--open`** | Dev server crashed or did not bind port | Check terminal output for runtime compile or syntax errors |

---

## Development and Testing

RunPad CLI has **zero production dependencies**. You only need Node.js to develop and run the automated test suite.

### Setup

```bash
git clone https://github.com/VTS-SPACE/runpad-cli.git
cd runpad-cli
```

### Running Tests

Run the complete native test suite using Node's built-in test runner:

```bash
npm test
```

Or run individual test suites:

```bash
node --test test/security_and_process.test.js
node --test test/runtime_detection.test.js
node --test test/java_runner.test.js
```

### Syntax and Packaging Checks

Verify entry-point syntax and inspect package tarball contents:

```bash
node --check bin/index.js
npm pack --dry-run --json
```

---

## Project Structure

```text
runpad-cli/
├── bin/
│   └── index.js                    # Core CLI entry point, resolvers & static server
├── test/
│   ├── java_runner.test.js          # Java JDK, Maven, Gradle & standalone tests
│   ├── runtime_detection.test.js    # Node, Vite, Python, .NET detection tests
│   └── security_and_process.test.js # Port sentinel, traversal & process tree tests
├── .gitignore                      # Git ignore patterns
├── LICENSE                         # MIT License
├── package.json                    # Package metadata & bin configuration
└── README.md                       # Documentation
```

---

## Known Limitations

- **Host Runtimes:** RunPad delegates execution to local compilers and interpreters. If a project requires Java, Python, or .NET, the corresponding runtime must be installed on your system.
- **Tested Platforms:** Automated regression suites run continuously on Windows 11. POSIX paths and shell execution paths (`lsof`, `kill -9`, `./mvnw`, `./gradlew`) are implemented and covered by unit mocks, but direct end-to-end testing on physical macOS and Linux environments is in progress.
- **Single Root Project Precedence:** In projects containing multiple conflicting root manifests (e.g., both a `package.json` and a `pom.xml` at root), RunPad evaluates according to documented detection precedence.

---

## Contributing

Contributions are welcome! Please ensure:

1. **Zero External Dependencies:** RunPad maintains a zero-dependency footprint. Use only Node.js standard library modules.
2. **Regression Tests:** Every bug fix or feature addition must include automated regression tests in the `test/` directory.
3. **Test Validation:** Run `npm test` and `node --check bin/index.js` to ensure 100% passing tests before submitting a Pull Request.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 VTS SPACE and RunPad Contributors.
