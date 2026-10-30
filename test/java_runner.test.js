const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const {
    detectJavaToolchain,
    findJavaFiles,
    findClasspathJars,
    analyzeJavaSource,
    selectJavaEntryPoint,
    resolveMavenCommand,
    resolveGradleCommand,
    registerCleanupPath,
    cleanupTemporaryFiles,
    cleanupPaths,
    inspectDirectory
} = require('../bin/index.js');

describe('Java Toolchain, Maven, Gradle & Standalone Java Tests', () => {
    const testBaseDir = path.join(__dirname, 'fixtures_java');

    before(() => {
        if (!fs.existsSync(testBaseDir)) {
            fs.mkdirSync(testBaseDir, { recursive: true });
        }
    });

    after(() => {
        cleanupTemporaryFiles();
        if (fs.existsSync(testBaseDir)) {
            try {
                fs.rmSync(testBaseDir, { recursive: true, force: true });
            } catch {}
        }
    });

    // 1. Toolchain Detection
    describe('1. Java Toolchain Detection', () => {
        it('Detects host JDK toolchain (java and javac available)', () => {
            const toolchain = detectJavaToolchain(true);
            assert.strictEqual(toolchain.hasJava, true, 'Host should have java runtime');
            assert.strictEqual(toolchain.hasJavac, true, 'Host should have javac compiler');
            assert.strictEqual(toolchain.isJdk, true, 'Host should be recognized as a JDK');
            assert.ok(typeof toolchain.javaPath === 'string' && toolchain.javaPath.length > 0);
            assert.ok(typeof toolchain.javacPath === 'string' && toolchain.javacPath.length > 0);
            assert.ok(toolchain.majorVersion >= 11, `Expected Java 11+, got ${toolchain.majorVersion}`);
        });

        it('Correctly identifies missing javac (JRE-only simulation)', () => {
            const mockDir = path.join(testBaseDir, 'mock_jre');
            const mockBin = path.join(mockDir, 'bin');
            fs.mkdirSync(mockBin, { recursive: true });
            const isWin = process.platform === 'win32';
            const javaExe = path.join(mockBin, isWin ? 'java.exe' : 'java');
            fs.writeFileSync(javaExe, '#!/bin/sh\nexit 0');

            const customEnv = { JAVA_HOME: mockDir, PATH: '' };
            const toolchain = detectJavaToolchain(true, customEnv, process.platform);

            // JRE simulation: hasJava may or may not execute mock file depending on OS, but hasJavac must be false
            assert.strictEqual(toolchain.hasJavac, false, 'Simulated JRE should not report javac');
            assert.strictEqual(toolchain.isJdk, false, 'JRE without javac is not a JDK');
        });

        it('Handles completely missing Java environment cleanly', () => {
            const customEnv = { JAVA_HOME: '', PATH: '' };
            const toolchain = detectJavaToolchain(true, customEnv, process.platform);
            // In clean empty PATH/JAVA_HOME, no java tools should be found
            assert.strictEqual(toolchain.hasJavac, false);
        });
    });

    // 2. Maven Wrapper & Goal Resolution
    describe('2. Maven Wrapper & Goal Selection', () => {
        it('Windows selects mvnw.cmd when mvnw.cmd is present', () => {
            const projDir = path.join(testBaseDir, 'maven_win_cmd');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>');
            fs.writeFileSync(path.join(projDir, 'mvnw.cmd'), '@echo off');
            fs.writeFileSync(path.join(projDir, 'mvnw'), '#!/bin/sh');

            const res = resolveMavenCommand(projDir, null, 'win32');
            assert.strictEqual(res.wrapper, 'mvnw.cmd');
            assert.strictEqual(res.detectedType, 'Java Spring Boot (Maven)');
            assert.strictEqual(res.runCommand, 'mvnw.cmd spring-boot:run');
        });

        it('Windows selects mvnw.bat when mvnw.cmd is absent but mvnw.bat is present', () => {
            const projDir = path.join(testBaseDir, 'maven_win_bat');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>');
            fs.writeFileSync(path.join(projDir, 'mvnw.bat'), '@echo off');

            const res = resolveMavenCommand(projDir, null, 'win32');
            assert.strictEqual(res.wrapper, 'mvnw.bat');
        });

        it('Windows falls back to system mvn when no wrappers exist', () => {
            const projDir = path.join(testBaseDir, 'maven_win_no_wrapper');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>');

            const res = resolveMavenCommand(projDir, null, 'win32');
            assert.strictEqual(res.wrapper, 'mvn');
            assert.strictEqual(res.runCommand, 'mvn spring-boot:run');
        });

        it('POSIX selects ./mvnw when mvnw is present', () => {
            const projDir = path.join(testBaseDir, 'maven_posix_wrapper');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>');
            fs.writeFileSync(path.join(projDir, 'mvnw'), '#!/bin/sh');

            const res = resolveMavenCommand(projDir, null, 'linux');
            assert.strictEqual(res.wrapper, './mvnw');
            assert.strictEqual(res.runCommand, './mvnw spring-boot:run');
        });

        it('POSIX falls back to system mvn when ./mvnw is missing', () => {
            const projDir = path.join(testBaseDir, 'maven_posix_no_wrapper');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project></project>');

            const res = resolveMavenCommand(projDir, null, 'linux');
            assert.strictEqual(res.wrapper, 'mvn');
            assert.strictEqual(res.detectedType, 'Java Maven Project');
            assert.strictEqual(res.runCommand, 'mvn compile exec:java');
        });

        it('Forwards custom port to Spring Boot Maven via system property', () => {
            const projDir = path.join(testBaseDir, 'maven_port');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'pom.xml'), '<project><artifactId>spring-boot</artifactId></project>');

            const res = resolveMavenCommand(projDir, 9090, 'win32');
            assert.strictEqual(res.targetPort, 9090);
            assert.ok(res.runCommand.includes('-Dspring-boot.run.arguments=--server.port=9090'));
        });
    });

    // 3. Gradle Wrapper & Goal Resolution
    describe('3. Gradle Wrapper & Goal Selection', () => {
        it('Windows selects gradlew.bat when present', () => {
            const projDir = path.join(testBaseDir, 'gradle_win_bat');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'build.gradle'), 'plugins { id "org.springframework.boot" version "3.0.0" }');
            fs.writeFileSync(path.join(projDir, 'gradlew.bat'), '@echo off');
            fs.writeFileSync(path.join(projDir, 'gradlew'), '#!/bin/sh');

            const res = resolveGradleCommand(projDir, null, 'win32');
            assert.strictEqual(res.wrapper, 'gradlew.bat');
            assert.strictEqual(res.detectedType, 'Java Spring Boot (Gradle)');
            assert.strictEqual(res.runCommand, 'gradlew.bat bootRun');
        });

        it('Windows falls back to gradle when gradlew.bat is absent', () => {
            const projDir = path.join(testBaseDir, 'gradle_win_no_wrapper');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'build.gradle'), 'plugins { id "application" }');

            const res = resolveGradleCommand(projDir, null, 'win32');
            assert.strictEqual(res.wrapper, 'gradle');
            assert.strictEqual(res.detectedType, 'Java Gradle Project');
            assert.strictEqual(res.runCommand, 'gradle run');
        });

        it('POSIX selects ./gradlew when gradlew is present', () => {
            const projDir = path.join(testBaseDir, 'gradle_posix');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'build.gradle.kts'), 'plugins { id("org.springframework.boot") }');
            fs.writeFileSync(path.join(projDir, 'gradlew'), '#!/bin/sh');

            const res = resolveGradleCommand(projDir, null, 'darwin');
            assert.strictEqual(res.wrapper, './gradlew');
            assert.strictEqual(res.detectedType, 'Java Spring Boot (Gradle)');
            assert.strictEqual(res.runCommand, './gradlew bootRun');
        });

        it('Forwards custom port to Spring Boot Gradle via --args', () => {
            const projDir = path.join(testBaseDir, 'gradle_port');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'build.gradle'), 'plugins { id "spring-boot" }');

            const res = resolveGradleCommand(projDir, 8888, 'win32');
            assert.strictEqual(res.targetPort, 8888);
            assert.ok(res.runCommand.includes('--args=--server.port=8888'));
        });
    });

    // 4. Source Parsing & Entry Point Selection
    describe('4. Java Source Analysis & Entry Point Resolution', () => {
        it('Correctly parses package, class name, and main method', () => {
            const file = path.join(testBaseDir, 'UserApp.java');
            fs.writeFileSync(file, `
                package com.acme.app;
                /* Comments with public static void main(String[] fake) */
                public class UserApp {
                    public static void main(String[] args) {
                        System.out.println("hello");
                    }
                }
            `);

            const info = analyzeJavaSource(file);
            assert.strictEqual(info.packageName, 'com.acme.app');
            assert.strictEqual(info.className, 'UserApp');
            assert.strictEqual(info.fqcn, 'com.acme.app.UserApp');
            assert.strictEqual(info.hasMain, true);
            assert.strictEqual(info.publicClassMismatch, false);
        });

        it('Flags public class and file name mismatch', () => {
            const file = path.join(testBaseDir, 'WrongFileName.java');
            fs.writeFileSync(file, `
                public class RealName {
                    public static void main(String[] args) {}
                }
            `);

            const info = analyzeJavaSource(file);
            assert.strictEqual(info.className, 'RealName');
            assert.strictEqual(info.publicClassMismatch, true);
        });

        it('Resolves ambiguous main methods by preferring Main.java', () => {
            const projDir = path.join(testBaseDir, 'ambiguous_entry');
            fs.mkdirSync(projDir, { recursive: true });

            fs.writeFileSync(path.join(projDir, 'Helper.java'), 'public class Helper { public static void main(String[] args) {} }');
            fs.writeFileSync(path.join(projDir, 'Main.java'), 'public class Main { public static void main(String[] args) {} }');

            const files = findJavaFiles(projDir);
            const selection = selectJavaEntryPoint(projDir, files);

            assert.strictEqual(selection.ambiguous, true);
            assert.strictEqual(selection.entryPoint.fileName, 'Main.java');
            assert.ok(selection.warning.includes('Multiple main entry points found'));
        });

        it('Returns NO_MAIN_METHOD diagnostic when no file defines main', () => {
            const projDir = path.join(testBaseDir, 'no_main');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'DataModel.java'), 'public class DataModel { private int id; }');

            const files = findJavaFiles(projDir);
            const selection = selectJavaEntryPoint(projDir, files);

            assert.strictEqual(selection.error, 'NO_MAIN_METHOD');
            assert.strictEqual(selection.entryPoint, null);
        });

        it('Sanitizes shell metacharacters in Java source filenames', () => {
            const projDir = path.join(testBaseDir, 'java_sanitize');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'App;evil.java'), 'public class Appevil { public static void main(String[] args) {} }');

            const detected = inspectDirectory(projDir);
            assert.ok(detected);
            assert.ok(!detected.runCommand.includes(';evil'));
            assert.ok(!detected.runCommand.includes('`'));
            assert.ok(!detected.runCommand.includes('$'));
            assert.ok(detected.runCommand.includes('Appevil.java'));
        });
    });

    // 5. Standalone Single-File Execution
    describe('5. Standalone Java Single-File Execution', () => {
        it('Inspects single-file Java project and generates direct java command', () => {
            const projDir = path.join(testBaseDir, 'single_file');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'App.java'), 'public class App { public static void main(String[] args) { System.out.println("SINGLE RUN"); } }');

            const project = inspectDirectory(projDir);
            assert.ok(project);
            assert.strictEqual(project.detectedType, 'Standalone Java (Single-File)');
            assert.ok(project.runCommand.includes('App.java'));
            assert.strictEqual(project.args[0], 'App.java');
        });

        it('Executes real single-file Java program and verifies stdout', () => {
            const toolchain = detectJavaToolchain();
            if (!toolchain.hasJava) return;

            const projDir = path.join(testBaseDir, 'single_exec');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'Hello.java'), 'public class Hello { public static void main(String[] args) { System.out.println("RUNPAD_SINGLE_SUCCESS"); } }');

            const project = inspectDirectory(projDir);
            assert.ok(project && project.runCommand);

            const res = spawnSync(project.runCommand, { shell: true, cwd: projDir, encoding: 'utf8' });
            assert.strictEqual(res.status, 0);
            assert.ok(res.stdout.includes('RUNPAD_SINGLE_SUCCESS'));
        });
    });

    // 6. Standalone Multi-File Execution with Package Declarations & Output Isolation
    describe('6. Standalone Java Multi-File Execution & Output Isolation', () => {
        it('Compiles multiple Java files with package into .runpad_out and executes FQCN', () => {
            const toolchain = detectJavaToolchain();
            if (!toolchain.isJdk) return;

            const projDir = path.join(testBaseDir, 'multi_file');
            const pkgDir = path.join(projDir, 'com', 'example');
            fs.mkdirSync(pkgDir, { recursive: true });

            fs.writeFileSync(path.join(pkgDir, 'Greeter.java'), `
                package com.example;
                public class Greeter {
                    public static String getGreeting() {
                        return "RUNPAD_MULTI_SUCCESS";
                    }
                }
            `);

            fs.writeFileSync(path.join(pkgDir, 'Main.java'), `
                package com.example;
                public class Main {
                    public static void main(String[] args) {
                        System.out.println(Greeter.getGreeting());
                    }
                }
            `);

            const project = inspectDirectory(projDir);
            assert.ok(project);
            assert.strictEqual(project.detectedType, 'Standalone Java (Multi-File)');
            assert.ok(project.runCommand.includes('-d ".runpad_out"'));
            assert.ok(project.runCommand.includes('com.example.Main'));

            // Execute the combined compile-and-run command
            const res = spawnSync(project.runCommand, { shell: true, cwd: projDir, encoding: 'utf8' });
            assert.strictEqual(res.status, 0, `Execution failed: ${res.stderr}`);
            assert.ok(res.stdout.includes('RUNPAD_MULTI_SUCCESS'));

            // Verify .runpad_out contains compiled classes
            const outDir = path.join(projDir, '.runpad_out');
            assert.strictEqual(fs.existsSync(outDir), true, '.runpad_out must exist after compilation');
            assert.strictEqual(fs.existsSync(path.join(outDir, 'com', 'example', 'Main.class')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'com', 'example', 'Greeter.class')), true);

            // Verify cleanup function removes .runpad_out
            cleanupTemporaryFiles();
            assert.strictEqual(fs.existsSync(outDir), false, '.runpad_out must be cleaned up');
        });

        it('Diagnoses compilation errors without attempting to run broken class', () => {
            const toolchain = detectJavaToolchain();
            if (!toolchain.isJdk) return;

            const projDir = path.join(testBaseDir, 'compiler_failure');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'Helper.java'), 'public class Helper {}');
            fs.writeFileSync(path.join(projDir, 'Main.java'), 'public class Main { public static void main(String[] args) { SYNTAX_ERROR_HERE; } }');

            const project = inspectDirectory(projDir);
            assert.ok(project && project.runCommand);

            const res = spawnSync(project.runCommand, { shell: true, cwd: projDir, encoding: 'utf8' });
            assert.notStrictEqual(res.status, 0, 'Javac must fail with non-zero exit code');
            assert.ok(res.stderr.includes('error: not a statement') || res.stderr.includes('error'));
        });
    });

    // 7. Paths Containing Spaces
    describe('7. Spaces in Paths Handling', () => {
        it('Executes multi-file Java project where directory path contains spaces', () => {
            const toolchain = detectJavaToolchain();
            if (!toolchain.isJdk) return;

            const projDir = path.join(testBaseDir, 'java path with spaces');
            const pkgDir = path.join(projDir, 'org', 'app');
            fs.mkdirSync(pkgDir, { recursive: true });

            fs.writeFileSync(path.join(pkgDir, 'Service.java'), `
                package org.app;
                public class Service {
                    public static String compute() { return "SPACES_OK"; }
                }
            `);

            fs.writeFileSync(path.join(pkgDir, 'Main.java'), `
                package org.app;
                public class Main {
                    public static void main(String[] args) {
                        System.out.println(Service.compute());
                    }
                }
            `);

            const project = inspectDirectory(projDir);
            assert.ok(project);
            assert.strictEqual(project.detectedType, 'Standalone Java (Multi-File)');

            const res = spawnSync(project.runCommand, { shell: true, cwd: projDir, encoding: 'utf8' });
            assert.strictEqual(res.status, 0, `Failed running in path with spaces: ${res.stderr}`);
            assert.ok(res.stdout.includes('SPACES_OK'));
        });
    });

    // 8. Missing JDK Diagnostics
    describe('8. Missing Toolchain Diagnostics', () => {
        it('Returns JDK_REQUIRED error when multi-file project lacks javac', () => {
            const projDir = path.join(testBaseDir, 'missing_jdk');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'A.java'), 'public class A {}');
            fs.writeFileSync(path.join(projDir, 'Main.java'), 'public class Main { public static void main(String[] args) {} }');

            const mockToolchain = {
                hasJava: true,
                hasJavac: false,
                isJdk: false,
                javaPath: 'java',
                javacPath: 'javac',
                majorVersion: 17
            };

            const project = inspectDirectory(projDir, { toolchain: mockToolchain });
            assert.ok(project);
            assert.strictEqual(project.error, 'JDK_REQUIRED');
            assert.ok(project.diagnostics.includes('JDK compiler ("javac") not found'));
            assert.strictEqual(project.runCommand, null);
        });

        it('Returns JAVA_NOT_FOUND error when single-file project lacks java runtime', () => {
            const projDir = path.join(testBaseDir, 'missing_java');
            fs.mkdirSync(projDir, { recursive: true });
            fs.writeFileSync(path.join(projDir, 'Main.java'), 'public class Main { public static void main(String[] args) {} }');

            const mockToolchain = {
                hasJava: false,
                hasJavac: false,
                isJdk: false,
                javaPath: 'java',
                javacPath: 'javac',
                majorVersion: null
            };

            const project = inspectDirectory(projDir, { toolchain: mockToolchain });
            assert.ok(project);
            assert.strictEqual(project.error, 'JAVA_NOT_FOUND');
            assert.ok(project.diagnostics.includes('Java runtime ("java") not found'));
        });
    });

    // 9. Classpath and External JAR Handling
    describe('9. External JAR Dependencies Detection', () => {
        it('Finds JAR files in lib/ directory and includes them in classpath', () => {
            const projDir = path.join(testBaseDir, 'with_jars');
            const libDir = path.join(projDir, 'lib');
            fs.mkdirSync(libDir, { recursive: true });
            fs.writeFileSync(path.join(libDir, 'mylib.jar'), 'PK dummy jar content');

            const jars = findClasspathJars(projDir);
            assert.strictEqual(jars.length, 1);
            assert.strictEqual(jars[0].replace(/\\/g, '/'), 'lib/mylib.jar');
        });
    });
});
