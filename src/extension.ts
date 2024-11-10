// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let isDatabaseBuilding = false;	// 데이터베이스 중복 빌드 방지 플래그

export function activate(context: vscode.ExtensionContext) {
	const cscopeOutPath = getCscopeOutPath();

  	// 호출 관계를 찾는 명령을 등록합니다.
	const findCallHierarchyCommand = vscode.commands.registerCommand('extension.findCallHierarchy', async () => {
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
			}
	});

	context.subscriptions.push(findCallHierarchyCommand);

	// 파일 변경 감지 및 빌드 설정
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{c,cpp,h}');
	watcher.onDidChange(async () => await conditionalBuild());
	watcher.onDidCreate(async () => await conditionalBuild());
	watcher.onDidDelete(async () => await conditionalBuild());

	context.subscriptions.push(watcher);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// 함수 호출자를 찾는 함수
async function findCallers(functionName: string): Promise<string[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
	vscode.window.showErrorMessage("No workspace folder found");
	return [];
	}
	const workspacePath = workspaceFolders[0].uri.fsPath;
	const cscopeOutPath = path.join(workspacePath, '.vscode', 'cscope.out');

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
	const cscopeOutPath = path.join(workspacePath, '.vscode', 'cscope.out');

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
async function buildCscopeDatabase(): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("No workspace folder found");
		return;
	}

	const workspacePath = workspaceFolders[0].uri.fsPath;
	const cscopeOutPath = path.join(workspacePath, '.vscode', 'cscope.out');

	return new Promise((resolve, reject) => {
		exec(`cscope -b -R -f "${cscopeOutPath}"`, { cwd: workspacePath }, (error, stdout, stderr) => {
		if (error) {
			vscode.window.showErrorMessage(`Error building cscope database: ${stderr}`);
			return reject(error);
		}
		vscode.window.showInformationMessage('Cscope database built successfully at .vscode/cscope.out');
		resolve();
		});
	});
}

// 조건부 빌드 함수 (중복 빌드 방지)
async function conditionalBuild(): Promise<void> {
	const cscopeOutPath = getCscopeOutPath();

	// 빌드 중이면 중복 빌드 방지
	if (isDatabaseBuilding) return;
	isDatabaseBuilding = true;

	try {
		// .vscode/cscope.out 파일이 존재할 경우에만 빌드
		if (fs.existsSync(cscopeOutPath)) {
			await buildCscopeDatabase();
		}
	} finally {
		isDatabaseBuilding = false;
	}
}

// cscope.out 파일 경로 함수
function getCscopeOutPath(): string {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) throw new Error("No workspace folder found");
	const workspacePath = workspaceFolders[0].uri.fsPath;
	return path.join(workspacePath, '.vscode', 'cscope.out');
}