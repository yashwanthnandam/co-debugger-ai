"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugInsightsProvider = exports.InsightDataItem = exports.FixSuggestionsProvider = exports.SuggestionItem = exports.RootCauseProvider = exports.InsightItem = exports.BreakpointsProvider = exports.BreakpointItem = void 0;
const vscode = __importStar(require("vscode"));
// ---------- Breakpoints ----------
class BreakpointItem extends vscode.TreeItem {
    constructor(label, reason, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.reason = reason;
        this.collapsibleState = collapsibleState;
        this.tooltip = `${this.label}: ${this.reason}`;
        this.description = this.reason;
    }
}
exports.BreakpointItem = BreakpointItem;
class BreakpointsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.items = [];
    }
    refresh(data) {
        if (data) {
            this.items = data.map(item => new BreakpointItem(item.location || 'Unknown location', item.reason || 'Intelligent analysis', vscode.TreeItemCollapsibleState.None));
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return Promise.resolve(this.items);
    }
}
exports.BreakpointsProvider = BreakpointsProvider;
// ---------- Root Cause ----------
class InsightItem extends vscode.TreeItem {
    constructor(label, description_text, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.description_text = description_text;
        this.collapsibleState = collapsibleState;
        this.tooltip = this.description_text;
        this.description = this.description_text;
    }
}
exports.InsightItem = InsightItem;
class RootCauseProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.items = [];
    }
    refresh(data) {
        if (data) {
            this.items = [
                new InsightItem('Description', data.description || 'No data', vscode.TreeItemCollapsibleState.None),
                new InsightItem('Explanation', data.explanation || 'No data', vscode.TreeItemCollapsibleState.None),
                new InsightItem('Confidence', typeof data.confidence === "number" ? `${(data.confidence * 100).toFixed(1)}%` : 'N/A', vscode.TreeItemCollapsibleState.None)
            ];
            if (data.relatedCode && data.relatedCode.length > 0) {
                const codeItem = new InsightItem('Related Code', '', vscode.TreeItemCollapsibleState.Expanded);
                codeItem.children = data.relatedCode.map((code) => new InsightItem(code, '', vscode.TreeItemCollapsibleState.None));
                this.items.push(codeItem);
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        var _a;
        return Promise.resolve((_a = element === null || element === void 0 ? void 0 : element.children) !== null && _a !== void 0 ? _a : this.items);
    }
}
exports.RootCauseProvider = RootCauseProvider;
// ---------- Fix Suggestions ----------
class SuggestionItem extends vscode.TreeItem {
    constructor(label, description_text, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.description_text = description_text;
        this.collapsibleState = collapsibleState;
        this.tooltip = this.description_text;
        this.description = this.description_text;
    }
}
exports.SuggestionItem = SuggestionItem;
class FixSuggestionsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.items = [];
    }
    refresh(data) {
        if (data && data.length > 0) {
            this.items = data.map(fix => {
                const item = new SuggestionItem(fix.description || 'Fix suggestion', `Confidence: ${(fix.confidence || 0) * 100}%`, vscode.TreeItemCollapsibleState.Collapsed);
                item.children = [
                    new SuggestionItem('Code', fix.code || 'No code provided', vscode.TreeItemCollapsibleState.None),
                    new SuggestionItem('Impact', fix.impact || 'Unknown impact', vscode.TreeItemCollapsibleState.None)
                ];
                return item;
            });
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        var _a;
        return Promise.resolve((_a = element === null || element === void 0 ? void 0 : element.children) !== null && _a !== void 0 ? _a : this.items);
    }
}
exports.FixSuggestionsProvider = FixSuggestionsProvider;
class InsightDataItem extends vscode.TreeItem {
    constructor(label, value, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.value = value;
        this.collapsibleState = collapsibleState;
        this.tooltip = value;
        this.description = value;
    }
}
exports.InsightDataItem = InsightDataItem;
class DebugInsightsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.items = [];
    }
    refresh(data) {
        if (data && data.length > 0) {
            this.items = data.map(insight => new InsightDataItem(insight.title || 'Debug Insight', insight.description || '', vscode.TreeItemCollapsibleState.None));
        }
        else {
            // Default items when no data is available
            this.items = [
                new InsightDataItem('No debug insights available', 'Run your code with debugging enabled to collect insights', vscode.TreeItemCollapsibleState.None)
            ];
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return Promise.resolve(this.items);
    }
}
exports.DebugInsightsProvider = DebugInsightsProvider;
//# sourceMappingURL=treeDataProviders.js.map