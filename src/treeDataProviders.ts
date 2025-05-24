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




// (Remove this duplicate declaration entirely)
export class InsightDataItem extends vscode.TreeItem {
    // Add the children property to support hierarchy
    public children?: InsightDataItem[];
    
    constructor(
        public readonly label: string,
        private value: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly iconPath?: vscode.ThemeIcon
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
    private rawData: any[] = [];

    refresh(data?: any[]) {
        if (data && data.length > 0) {
            // Convert flat data to hierarchical structure
            console.log("Refreshing Debug Insights with", data.length, "items");
            const hierarchicalItems: InsightDataItem[] = [];
            let currentSection: InsightDataItem | null = null;
            
            for (const insight of data) {
                // Check if this is a section header
                const isSectionHeader = 
                    insight.title === "Key Variables" || 
                    insight.title === "Execution Context" ||
                    insight.title === "State Variables" ||
                    insight.title === "Control Variables" || 
                    insight.title === "Data Variables" ||
                    insight.title === "Other Variables";
                
                if (isSectionHeader) {
                    // Create a new section with expanded state
                    currentSection = new InsightDataItem(
                        insight.title,
                        insight.description || '',
                        vscode.TreeItemCollapsibleState.Expanded,
                        insight.iconPath
                    );
                    currentSection.children = []; // Initialize children array
                    hierarchicalItems.push(currentSection);
                }
                // If this is a breakpoint hit or other top-level item
                else if (insight.title.startsWith("Breakpoint hit") || 
                        insight.title.includes("Issue") ||
                        currentSection === null) {
                    // Add as top-level item
                    hierarchicalItems.push(new InsightDataItem(
                        insight.title,
                        insight.description || '',
                        vscode.TreeItemCollapsibleState.None,
                        insight.iconPath
                    ));
                }
                // Otherwise add as child to current section
                else if (currentSection) {
                    // Add this insight as a child of the current section
                    currentSection.children!.push(new InsightDataItem(
                        insight.title,
                        insight.description || '',
                        vscode.TreeItemCollapsibleState.None,
                        insight.iconPath
                    ));
                }
            }
            
            // Use the hierarchical items instead of flat list
            this.items = hierarchicalItems;
            this.rawData = data || [];

            // Log the structure we created
            console.log("Debug insights refreshed with sections:", hierarchicalItems.map(i => 
                `${i.label} (${i.children?.length || 0} children)`).join(", "));
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

    getData(): any[] {
        return this.rawData;
    }
    
    
    getChildren(element?: InsightDataItem): Thenable<InsightDataItem[]> {
        if (element) {
            // Return children of the specified element
            return Promise.resolve(element.children || []);
        } else {
            // Return root items
            return Promise.resolve(this.items);
        }
    }
}