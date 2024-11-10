// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CscopeCallHierarchyProvider } from './CscopeCallHierarchyProvider';	// 호출 관계 트리 뷰
import * as lodash from 'lodash';

let isDatabaseBuilding = false;	// 데이터베이스 중복 빌드 방지 플래그
let callHierarchyProvider: CscopeCallHierarchyProvider;	// 호출 관계 트리 뷰
let watcher: vscode.FileSystemWatcher; // 파일 감시자
let context: vscode.ExtensionContext; // 컨텍스트 저장

// 변경된 파일 경로를 저장할 Set
let modifiedFiles = new Set<string>();

export function activate(ctx: vscode.ExtensionContext) {
	context = ctx; // 컨텍스트 저장
	callHierarchyProvider = new CscopeCallHierarchyProvider();
	vscode.window.registerTreeDataProvider('cscopeCallHierarchy', callHierarchyProvider);
	// 호출 관계 트리 뷰 등록

  	// 호출 관계를 찾는 명령을 등록합니다.
	const findCallHierarchyCommand = vscode.commands.registerCommand('extension.findCallHierarchy', async () => {
		const cscopeOutPath = getCscopeOutPath();

		if (!fs.existsSync(cscopeOutPath)) {
			console.log("Cscope database not found. Building database...");
			await buildCscopeDatabase(); // 데이터베이스 파일이 없을 때만 빌드
			console.log("Cscope database built successfully at .vscode/cscope.out");
		}
		else {
			console.log("Cscope database found at .vscode/cscope.out");
		}

		const functionName = await vscode.window.showInputBox({ prompt: 'Enter function name to search call hierarchy' });
			if (functionName) {
				const callers = await findCallers(functionName);
				const callees = await findCallees(functionName);

				// 검색 결과를 출력 창에 표시합니다.
				const outputChannel = vscode.window.createOutputChannel("Cscope Call Hierarchy");
				outputChannel.show();
				outputChannel.appendLine(`Callers of ${functionName}:\n`);
				callers.forEach(caller => outputChannel.appendLine(caller));

				outputChannel.appendLine(`\nCallees of ${functionName}:\n`);
				callees.forEach(callee => outputChannel.appendLine(callee));

				// 호출 관계 트리 뷰에 검색 결과를 전달합니다.
				callHierarchyProvider.refresh(callers, callees);
			}
	});

	context.subscriptions.push(findCallHierarchyCommand);

	// 파일 변경 감지 및 빌드 설정
	setUpFileWatcher(); // 파일 감시자 설정

	context.subscriptions.push(watcher);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// 파일 감시자 설정 함수
function setUpFileWatcher() {
    // 파일 감시자 설정 (cscope 출력 디렉토리를 제외)
    watcher = vscode.workspace.createFileSystemWatcher('**/*.{c,cpp,h}', false, false, false);
    watcher.onDidChange(async (uri) => {
        if (isCscopeOutputFile(uri)) return; // cscope 출력 파일이면 무시
		modifiedFiles.add(uri.fsPath);
        await conditionalBuildDebounced();
    });
    watcher.onDidCreate(async (uri) => {
        if (isCscopeOutputFile(uri)) return; // cscope 출력 파일이면 무시
		modifiedFiles.add(uri.fsPath);
        await conditionalBuildDebounced();
    });
    watcher.onDidDelete(async (uri) => {
        if (isCscopeOutputFile(uri)) return; // cscope 출력 파일이면 무시
		modifiedFiles.add(uri.fsPath);
        await conditionalBuildDebounced();
    });

    context.subscriptions.push(watcher);
}


// 함수 호출자를 찾는 함수
async function findCallers(functionName: string): Promise<string[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("No workspace folder found");
		return [];
	}
	const workspacePath = workspaceFolders[0].uri.fsPath;
	const cscopeOutPath = getCscopeOutPath();

	return new Promise((resolve, reject) => {
		// -f 옵션으로 cscope.out 파일 경로를 명확히 지정
		exec(`cscope -dL -3 ${functionName} -f "${cscopeOutPath}"`, (error, stdout) => {
			if (error) {
				vscode.window.showErrorMessage(`Error finding callers for ${functionName}: ${error.message}`);
				return reject(error);
			}
			const callers = stdout.split('\n').filter(line => line.trim() !== '');
			resolve(callers);
		});
	});
}

// 함수 피호출자를 찾는 함수
async function findCallees(functionName: string): Promise<string[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("No workspace folder found");
		return [];
	}

	const workspacePath = workspaceFolders[0].uri.fsPath;
	const cscopeOutPath = getCscopeOutPath();

	return new Promise((resolve, reject) => {
		// -f 옵션으로 cscope.out 파일 경로를 명확히 지정
		exec(`cscope -dL -2 ${functionName} -f "${cscopeOutPath}"`, (error, stdout) => {
			if (error) {
				vscode.window.showErrorMessage(`Error finding callees for ${functionName}: ${error.message}`);
				return reject(error);
			}
			const callees = stdout.split('\n').filter(line => line.trim() !== '');
			resolve(callees);
		});
	});
}

// cscope 데이터베이스 빌드 함수
async function buildCscopeDatabase(fullBuild: boolean = false): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }
    console.log("Building cscope database...");
    const workspacePath = workspaceFolders[0].uri.fsPath;
    const cscopeDir = getCscopeDir();

    // cscope 출력 디렉토리가 없으면 생성
    if (!fs.existsSync(cscopeDir)) {
        fs.mkdirSync(cscopeDir, { recursive: true });
    }

    const cscopeOutPath = getCscopeOutPath();
    const cscopeFilesPath = path.join(cscopeDir, 'cscope.files');

    if (fullBuild || !fs.existsSync(cscopeFilesPath)) {
        // 전체 빌드: cscope.files 생성
        await generateCscopeFiles();
    } else {
        // 변경된 파일 업데이트
        updateCscopeFiles();
    }

    return new Promise((resolve, reject) => {
        const command = fullBuild
            ? `cscope -b -q -i "${cscopeFilesPath}" -f "${cscopeOutPath}"`
            : `cscope -b -q -u -i "${cscopeFilesPath}" -f "${cscopeOutPath}"`;

        exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
            if (error) {
                console.error('Error building cscope database:', stderr);
                vscode.window.showErrorMessage(`Error building cscope database: ${stderr}`);
                return reject(error);
            }
            console.log('Cscope database built successfully.');
            vscode.window.showInformationMessage('Cscope database built successfully at .vscode/cscope/cscope.out');
            resolve();
        });
    });
}

// cscope.files 생성 함수
async function generateCscopeFiles(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
    const workspacePath = workspaceFolders[0].uri.fsPath;
    const cscopeDir = getCscopeDir();
    const cscopeFilesPath = path.join(cscopeDir, 'cscope.files');

    return new Promise((resolve, reject) => {
        // 파일 목록을 수집하기 위한 배열
        let fileList: string[] = [];

        // 재귀적으로 디렉토리를 탐색하는 함수
        function walkDir(dir: string) {
            const files = fs.readdirSync(dir);
            files.forEach((file) => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    // 숨김 디렉토리(.git, .vscode 등)는 제외
                    if (!file.startsWith('.')) {
                        walkDir(fullPath);
                    }
                } else if (stat.isFile()) {
                    // .c, .cpp, .h 확장자 파일만 수집
                    if (/\.(c|cpp|h)$/i.test(file)) {
                        // 상대 경로를 사용
                        const relativePath = path.relative(workspacePath, fullPath);
                        // 경로의 구분자를 '/'로 변경 (Windows 호환성)
                        const normalizedPath = relativePath.split(path.sep).join('/');
                        fileList.push(normalizedPath);
                    }
                }
            });
        }

        try {
            walkDir(workspacePath);

            // 수집된 파일 목록을 cscope.files에 저장
            fs.writeFileSync(cscopeFilesPath, fileList.join('\n'));

            console.log('cscope.files generated successfully.');
            resolve();
        } catch (error) {
            console.error('Error generating cscope.files:', error);
            reject(error);
        }
    });
}

// cscope.files 업데이트 함수
function updateCscopeFiles() {
    const cscopeDir = getCscopeDir();
    const cscopeFilesPath = path.join(cscopeDir, 'cscope.files');
	const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
	const workspacePath = workspaceFolders[0].uri.fsPath;

    let existingFiles = fs.readFileSync(cscopeFilesPath, 'utf-8').split('\n').filter(line => line.trim() !== '');

	// 변경된 파일 처리
	modifiedFiles.forEach(filePath => {
        // 워크스페이스 경로 기준으로 상대 경로 변환
        let relativePath = path.relative(workspacePath, filePath);
        // 경로 구분자를 '/'로 통일 (Windows 호환성)
        relativePath = relativePath.split(path.sep).join('/');

        if (fs.existsSync(filePath)) {
            // 파일이 존재하면 목록에 추가 (중복 방지)
            if (!existingFiles.includes(relativePath)) {
                existingFiles.push(relativePath);
            }
        } else {
            // 파일이 삭제된 경우 목록에서 제거
            existingFiles = existingFiles.filter(f => f !== relativePath);
        }
    });

    // 변경된 파일 목록 초기화
    modifiedFiles.clear();

    // 업데이트된 파일 목록 저장
    fs.writeFileSync(cscopeFilesPath, existingFiles.join('\n'));
}

// 조건부 빌드 함수 (중복 빌드 방지)
async function conditionalBuild(): Promise<void> {
	const cscopeOutPath = getCscopeOutPath();

	// 빌드 중이면 중복 빌드 방지
	if (isDatabaseBuilding) return;
	isDatabaseBuilding = true;

	try {
		// .vscode/cscope.out 파일이 존재할 경우에만 빌드
		console.log("Checking if cscope database needs to be built...");

		// 파일 감시자 일시 중지
        watcher.dispose();

		if (!fs.existsSync(cscopeOutPath)) {
            // 데이터베이스가 없으면 전체 빌드
            await buildCscopeDatabase(true);
        } else {
            // 변경된 파일이 있으면 업데이트 빌드
            if (modifiedFiles.size > 0) {
                await buildCscopeDatabase(false);
            } else {
				console.log("No changes detected. Skipping cscope database build.");
			}
        }
	} finally {
		isDatabaseBuilding = false;
		setUpFileWatcher(); // 파일 감시자 재설정
	}
}

function isCscopeOutputFile(uri: vscode.Uri): boolean {
	const fileName = path.basename(uri.fsPath);
	return fileName.startsWith('cscope.');
}

const conditionalBuildDebounced = lodash.debounce(async () => {
	await conditionalBuild();
}, 5000); // 2초의 지연을 적용

// // cscope.out 파일 경로 함수
// function getCscopeOutPath(): string {
// 	const workspaceFolders = vscode.workspace.workspaceFolders;
// 	if (!workspaceFolders) throw new Error("No workspace folder found");
// 	const workspacePath = workspaceFolders[0].uri.fsPath;
// 	return path.join(workspacePath, '.vscode', 'cscope.out');
// }

// cscope.out 파일 경로 함수
function getCscopeOutPath(): string {
    const cscopeDir = getCscopeDir();
    return path.join(cscopeDir, 'cscope.out');
}

// cscope 출력 디렉토리 경로 함수
function getCscopeDir(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) throw new Error("No workspace folder found");
    const workspacePath = workspaceFolders[0].uri.fsPath;
    return path.join(workspacePath, '.vscode', 'cscope');
}