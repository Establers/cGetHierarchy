import * as vscode from 'vscode';

export class CscopeCallHierarchyProvider implements vscode.TreeDataProvider<CallHierarchyItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CallHierarchyItem | undefined | void> = new vscode.EventEmitter<CallHierarchyItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<CallHierarchyItem | undefined | void> = this._onDidChangeTreeData.event;

    private callers: string[] = [];
    private callees: string[] = [];

    constructor() {}

    refresh(callers: string[], callees: string[]): void {
        this.callers = callers;
        this.callees = callees;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CallHierarchyItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CallHierarchyItem): vscode.ProviderResult<CallHierarchyItem[]> {
        if (!element) {
            // Root level: separate callers and callees
            return [
                new CallHierarchyItem('Callers', vscode.TreeItemCollapsibleState.Expanded, 'header'),
                new CallHierarchyItem('Callees', vscode.TreeItemCollapsibleState.Expanded, 'header')
            ];
        } else if (element.type === 'header') {
            // Display callers or callees based on element label
            const items = (element.label === 'Callers' ? this.callers : this.callees)
                .map(name => new CallHierarchyItem(name, vscode.TreeItemCollapsibleState.None, 'item'));
            return items;
        }
        return [];
    }
}

class CallHierarchyItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'header' | 'item'
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        if (type === 'header') {
            this.iconPath = new vscode.ThemeIcon('symbol-method');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-function');
        }
    }
}
