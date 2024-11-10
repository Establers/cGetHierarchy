// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';


export function activate(context: vscode.ExtensionContext) {
  	// 호출 관계를 찾는 명령을 등록합니다.
	const findCallHierarchyCommand = vscode.commands.registerCommand('extension.findCallHierarchy', async () => {
		await buildCscopeDatabase();	// cscope 데이터베이스를 빌드합니다.
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