import * as vscode from 'vscode';

// ---------- Breakpoints ----------
export class BreakpointItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        private reason: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}: ${this.reason}`;
        this.description = this.reason;
    }
}

export class BreakpointsProvider implements vscode.TreeDataProvider<BreakpointItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BreakpointItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<BreakpointItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private items: BreakpointItem[] = [];

    refresh(data?: any[]) {
        if (data) {
            this.items = data.map(item => new BreakpointItem(
                item.location || 'Unknown location',
                item.reason || 'Intelligent analysis',
                vscode.TreeItemCollapsibleState.None
            ));
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BreakpointItem): vscode.TreeItem {
        return element;
    }
    getChildren(element?: BreakpointItem): Thenable<BreakpointItem[]> {
        return Promise.resolve(this.items);
    }
}

// ---------- Root Cause ----------
export class InsightItem extends vscode.TreeItem {
    public children?: InsightItem[];
    constructor(
        public readonly label: string,
        private description_text: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = this.description_text;
        this.description = this.description_text;
    }
}

export class RootCauseProvider implements vscode.TreeDataProvider<InsightItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<InsightItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<InsightItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private items: InsightItem[] = [];

    refresh(data?: any) {
        if (data) {
            this.items = [
                new InsightItem('Description', data.description || 'No data', vscode.TreeItemCollapsibleState.None),
                new InsightItem('Explanation', data.explanation || 'No data', vscode.TreeItemCollapsibleState.None),
                new InsightItem('Confidence', typeof data.confidence === "number" ? `${(data.confidence * 100).toFixed(1)}%` : 'N/A', vscode.TreeItemCollapsibleState.None)
            ];
            if (data.relatedCode && data.relatedCode.length > 0) {
                const codeItem = new InsightItem('Related Code', '', vscode.TreeItemCollapsibleState.Expanded);
                codeItem.children = data.relatedCode.map((code: string) =>
                    new InsightItem(code, '', vscode.TreeItemCollapsibleState.None)
                );
                this.items.push(codeItem);
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element: InsightItem): vscode.TreeItem {
        return element;
    }
    getChildren(element?: InsightItem): Thenable<InsightItem[]> {
        return Promise.resolve(element?.children ?? this.items);
    }
}

// ---------- Fix Suggestions ----------
export class SuggestionItem extends vscode.TreeItem {
    public children?: SuggestionItem[];
    constructor(
        public readonly label: string,
        private description_text: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = this.description_text;
        this.description = this.description_text;
    }
}

export class FixSuggestionsProvider implements vscode.TreeDataProvider<SuggestionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SuggestionItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<SuggestionItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private items: SuggestionItem[] = [];

    refresh(data?: any[]) {
        if (data && data.length > 0) {
            this.items = data.map(fix => {
                const item = new SuggestionItem(
                    fix.description || 'Fix suggestion',
                    `Confidence: ${(fix.confidence || 0) * 100}%`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.children = [
                    new SuggestionItem('Code', fix.code || 'No code provided', vscode.TreeItemCollapsibleState.None),
                    new SuggestionItem('Impact', fix.impact || 'Unknown impact', vscode.TreeItemCollapsibleState.None)
                ];
                return item;
            });
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element: SuggestionItem): vscode.TreeItem {
        return element;
    }
    getChildren(element?: SuggestionItem): Thenable<SuggestionItem[]> {
        return Promise.resolve(element?.children ?? this.items);
    }
}


export class InsightDataItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        private value: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = value;
        this.description = value;
    }
}

export class DebugInsightsProvider implements vscode.TreeDataProvider<InsightDataItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<InsightDataItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<InsightDataItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private items: InsightDataItem[] = [];

    
    refresh(data?: any[]) {
        if (data && data.length > 0) {
            this.items = data.map(insight => new InsightDataItem(
                insight.title || 'Debug Insight',
                insight.description || '',
                vscode.TreeItemCollapsibleState.None
            ));
        } else {
            // Default items when no data is available
            this.items = [
                new InsightDataItem(
                    'No debug insights available',
                    'Run your code with debugging enabled to collect insights',
                    vscode.TreeItemCollapsibleState.None
                )
            ];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: InsightDataItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: InsightDataItem): Thenable<InsightDataItem[]> {
        return Promise.resolve(this.items);
    }
}