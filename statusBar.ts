import * as vscode from 'vscode';

export class StatusBarManager {
    private analyzeButton: vscode.StatusBarItem;
    private debugButton: vscode.StatusBarItem;
    private insightsButton: vscode.StatusBarItem;

    constructor() {
        // Create status bar items
        this.analyzeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.analyzeButton.text = "$(search) Analyze";
        this.analyzeButton.command = "codebugger.analyzeProject";
        this.analyzeButton.tooltip = "Analyze project for bugs";

        this.debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.debugButton.text = "$(debug) Debug with AI";
        this.debugButton.command = "codebugger.start";
        this.debugButton.tooltip = "Start AI-enhanced debugging";

        this.insightsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.insightsButton.text = "$(graph) Insights";
        this.insightsButton.command = "codebugger.viewInsights";
        this.insightsButton.tooltip = "View AI debug insights";

        // Show all items
        this.analyzeButton.show();
        this.debugButton.show();
        this.insightsButton.show();
    }

    dispose() {
        this.analyzeButton.dispose();
        this.debugButton.dispose();
        this.insightsButton.dispose();
    }
}