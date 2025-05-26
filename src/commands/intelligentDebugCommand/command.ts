import * as vscode from 'vscode';
import * as path from 'path';
import { CodeAnalyzer } from '../../codeAnalyzer';
import { BreakpointManager } from '../../breakpointManager';
import { DataCollector } from '../../dataCollector';
import { DebugInsightsProvider } from '../../treeDataProviders';
import { BreakpointRanker } from '../../algorithms/breakPointRanker';
import { LLMService } from '../../llmService';
import { DebugSessionManager } from './debugSessionManager';
import { VariableAnalyzer } from './variableAnalyzer';

/**
 * Command that provides a complete intelligent debugging experience
 */
export class IntelligentDebugCommand {
    private context: vscode.ExtensionContext;
    private codeAnalyzer: CodeAnalyzer;
    private breakpointManager: BreakpointManager;
    private dataCollector: DataCollector;
    private debugInsightsProvider: DebugInsightsProvider;
    private breakpointRanker: BreakpointRanker;
    private statusBarItem: vscode.StatusBarItem;
    private llmService: LLMService;
    
    // Added components from our file split
    private variableAnalyzer: VariableAnalyzer;
    private debugSessionManager: DebugSessionManager;

    constructor(
        context: vscode.ExtensionContext,
        codeAnalyzer: CodeAnalyzer,
        breakpointManager: BreakpointManager,
        dataCollector: DataCollector,
        debugInsightsProvider: DebugInsightsProvider,
        breakpointRanker: BreakpointRanker,
        llmService: LLMService,
    ) {
        this.context = context;
        this.codeAnalyzer = codeAnalyzer;
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.debugInsightsProvider = debugInsightsProvider;
        this.breakpointRanker = breakpointRanker;
        this.llmService = llmService;
        
        // Initialize our new components
        this.variableAnalyzer = new VariableAnalyzer(this.llmService);
        this.debugSessionManager = new DebugSessionManager(
            this.context,
            this.breakpointManager,
            this.dataCollector,
            this.debugInsightsProvider,
            this.variableAnalyzer
        );

        // Create status bar item for debugging status
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.text = "$(debug) Intelligent Debug";
        this.statusBarItem.tooltip = "Start intelligent debugging";
        this.statusBarItem.command = "intelligent-debugger.startIntelligenDebug";
        context.subscriptions.push(this.statusBarItem);
        this.statusBarItem.show();
        
        // Register the command
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'intelligent-debugger.startIntelligentDebug', 
                this.execute, this
            )
        );
        
        // Register the debug event listener
        context.subscriptions.push(
            vscode.debug.onDidTerminateDebugSession(() => {
                this.updateStatusBar('idle');
            })
        );
    }
    
    /**
     * Updates the status bar with current debug state
     */
    private updateStatusBar(state: 'idle' | 'analyzing' | 'debugging' | 'breakpoint') {
        switch (state) {
            case 'idle':
                this.statusBarItem.text = "$(debug) Intelligent Debug";
                this.statusBarItem.tooltip = "Start intelligent debugging";
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'analyzing':
                this.statusBarItem.text = "$(sync~spin) Analyzing Code";
                this.statusBarItem.tooltip = "Analyzing code for optimal breakpoints";
                break;
            case 'debugging':
                this.statusBarItem.text = "$(bug) Intelligent Debugging Active";
                this.statusBarItem.tooltip = "Intelligent debugging is active";
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'breakpoint':
                this.statusBarItem.text = "$(debug-breakpoint) Breakpoint Hit";
                this.statusBarItem.tooltip = "A breakpoint has been hit";
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }

    /**
     * Execute the intelligent debug command with optional debugging focus
     */
    public async execute(): Promise<void> {
        // Get active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor. Open a file to debug.");
            return;
        }
        
        const document = editor.document;
        const filePath = document.uri.fsPath;
        
        // Verify it's a supported file type
        if (!this.isSupportedFileType(filePath)) {
            vscode.window.showErrorMessage(
                "This file type is not supported for intelligent debugging. Supported types: .js, .ts, .jsx, .tsx"
            );
            return;
        }
        
        // Ask user what they want to focus on debugging
        const debugFocus = await vscode.window.showInputBox({
            prompt: "What do you want to focus on debugging? (e.g., 'user validation', 'data processing', or leave empty for general debugging)",
            placeHolder: "Enter debugging goal or focus area...",
        });
        
        // Save the file before debugging
        if (document.isDirty) {
            await document.save();
        }
        
        // Update UI to show we're analyzing
        this.updateStatusBar('analyzing');
        
        // Show welcome message if this is the first time
        const hasShownWelcome = this.context.globalState.get('intelligentDebugger.hasShownWelcome');
        if (!hasShownWelcome) {
            this.showWelcomeMessage();
            this.context.globalState.update('intelligentDebugger.hasShownWelcome', true);
        }
        
        // Start the intelligent debugging process
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Preparing Intelligent Debugging",
                cancellable: true
            },
            async (progress, token) => {
                progress.report({ increment: 0, message: "Analyzing code..." });
                
                try {
                    // Step 1: Analyze the code
                    await this.codeAnalyzer.analyzeCode(document.getText(), document.fileName);
                    progress.report({ increment: 30, message: "Finding optimal breakpoints..." });
                    
                    if (token.isCancellationRequested) return;
                    
                    // Step 2: Find optimal breakpoints
                    const nodes = Array.from(this.codeAnalyzer.getNodes().values());
                    
                    // Skip if no nodes found
                    if (nodes.length === 0) {
                        vscode.window.showWarningMessage(
                            "No code structure found for intelligent debugging. Running with standard debugging."
                        );
                        this.debugSessionManager.launchDebugger(filePath);
                        return;
                    }
                    
                    // Rank nodes for breakpoints - consider debug focus if provided
                    const rankedNodes = debugFocus ? 
                        await this.breakpointRanker.rankNodesForBreakpointsWithFocus(nodes, debugFocus) :
                        this.breakpointRanker.rankNodesForBreakpoints(nodes);
                    
                    progress.report({ increment: 20, message: "Setting breakpoints..." });
                    
                    if (token.isCancellationRequested) return;
                    
                    // Step 3: Set intelligent breakpoints
                    // Clear existing breakpoints
                    this.breakpointManager.clearBreakpoints();
                    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
                    
                    // Set new breakpoints based on ranked nodes
                    const topN = Math.min(5, rankedNodes.length); // Limit to top 5 breakpoints
                    for (let i = 0; i < topN; i++) {
                        const node = rankedNodes[i];
                        await this.breakpointManager.addBreakpoint(
                            document.uri,
                            node.location.line - 1, // VS Code is 0-based
                            node.location.column,
                            node.id,
                            this.getBreakpointDescription(node, debugFocus) // Pass focus to description
                        );
                    }
                    
                    progress.report({ increment: 20, message: "Preparing debug insights..." });
                    
                    if (token.isCancellationRequested) return;
                    
                    // Step 4: Set up debug insights view
                    // Clear previous data
                    this.dataCollector.clearData();
                    
                    // Initialize Debug Insights panel with static analysis results
                    const potentialIssues = this.getPotentialIssues(nodes);
                    if (this.debugInsightsProvider) {
                        this.debugInsightsProvider.refresh([
                            {
                                title: "Static Analysis Complete",
                                description: `Found ${nodes.length} code structures for analysis`
                            },
                            ...potentialIssues.map(issue => ({
                                title: issue.title,
                                description: issue.description
                            }))
                        ]);
                    } else {
                        console.warn('Debug insights provider is not available');
                    }
                    
                    progress.report({ increment: 15, message: "Setting up debug session..." });
                    
                    if (token.isCancellationRequested) return;
                    
                    // Step 5: Set up debug session with custom message handler
                    this.debugSessionManager.setupCustomDebugEventHandler();
                    
                    progress.report({ increment: 15, message: "Starting debugger..." });
                    
                    // Step 6: Launch the debugger
                    this.debugSessionManager.launchDebugger(filePath);
                    
                    // Update status bar
                    this.updateStatusBar('debugging');
                    
                    // Show success message
                    vscode.window.showInformationMessage(
                        `Intelligent debugging started with ${topN} optimized breakpoints`,
                        "View Debug Insights"
                    ).then(selection => {
                        if (selection === "View Debug Insights") {
                            vscode.commands.executeCommand('intelligent-debugger.viewInsights');
                        }
                    });
                    
                } catch (error) {
                    console.error("Error in intelligent debugging:", error);
                    vscode.window.showErrorMessage(
                        `Error preparing intelligent debugging: ${error.message}`
                    );
                    // Fall back to standard debugging
                    this.debugSessionManager.launchDebugger(filePath);
                    this.updateStatusBar('idle');
                }
            }
        );
    }

    /**
     * Create a description for an intelligent breakpoint
     */
    private getBreakpointDescription(node: any, debugFocus?: string): string {
        // Use your analysis to describe why this breakpoint is important
        const reasons: string[] = [];
        
        if (node.metadata.isCritical) {
            reasons.push("Critical code path - important for program correctness");
        }
        
        if (node.metadata.isLoop) {
            reasons.push("Loop entry point - good for tracking iterations");
        }
        
        if (node.metadata.isBranch) {
            reasons.push("Branch condition - determines execution path");
        }
        
        if (node.metadata.isErrorHandling) {
            reasons.push("Error handling code - helps diagnose failures");
        }
        
        if (node.metadata.semanticComplexity && node.metadata.semanticComplexity > 2) {
            reasons.push("Complex code section - high cognitive complexity");
        }
        
        if (node.metadata.potentialBugs && node.metadata.potentialBugs.length > 0) {
            reasons.push(`Potential issue: ${node.metadata.potentialBugs[0]}`);
        }
        
        // Add context about the debug focus if provided
        if (debugFocus) {
            reasons.push(`Relevant to "${debugFocus}" debugging focus`);
        }
        
        return reasons.join(". ");
    }
        
    /**
     * Extract potential issues from the analyzed nodes
     */
    private getPotentialIssues(nodes: any[]): Array<{ title: string, description: string }> {
        const issues = [];
        
        // Look for nodes with potential bugs
        for (const node of nodes) {
            if (node.metadata.potentialBugs && node.metadata.potentialBugs.length > 0) {
                for (const bug of node.metadata.potentialBugs) {
                    issues.push({
                        title: `Potential Issue at line ${node.location.line}`,
                        description: bug
                    });
                }
            }
        }
        
        // Check for error handling issues
        const hasErrorHandling = nodes.some(node => node.metadata.isErrorHandling);
        if (!hasErrorHandling) {
            issues.push({
                title: "Limited Error Handling",
                description: "This file has no explicit error handling patterns"
            });
        }
        
        // Check for overly complex functions
        const complexNodes = nodes.filter(node => 
            node.complexity > 5 || 
            (node.metadata.semanticComplexity && node.metadata.semanticComplexity > 3)
        );
        
        if (complexNodes.length > 0) {
            issues.push({
                title: `${complexNodes.length} Complex Code Sections`,
                description: "These sections may be difficult to understand and maintain"
            });
        }
        
        return issues;
    }
    
    /**
     * Check if the file type is supported for intelligent debugging
     */
    private isSupportedFileType(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
    }
    
    /**
     * Show welcome message for first-time users
     */
    private showWelcomeMessage(): void {
        const message = "Welcome to Intelligent Debugging! This extension helps find and diagnose bugs in your code through AI-powered analysis.";
        
        vscode.window.showInformationMessage(
            message,
            "Learn More",
            "Don't Show Again"
        ).then(selection => {
            if (selection === "Learn More") {
                // Open documentation or walkthrough
                vscode.env.openExternal(
                    vscode.Uri.parse("https://github.com/yashwanthnandam/intelligent-debugger")
                );
            }
        });
    }
    
    /**
     * Find the most informative variables in the current context
     * Public method used by other components
     */
    public findMostInformativeVariables(variables: Record<string, any>): [string, any][] {
        return this.variableAnalyzer.findMostInformativeVariables(variables);
    }

     /**
     * Update debug insights with runtime data
     * This proxy method maintains compatibility with external code
     */
    public async updateDebugInsightsWithRuntimeData(
        fileName: string,
        lineNumber: number,
        variables: Record<string, any>,
        callStack: string[],
        dataPoint: any,
        nodeId: string
    ): Promise<void> {
        // Delegate to the debug session manager
        return this.debugSessionManager.updateDebugInsightsWithRuntimeData(
            fileName, lineNumber, variables, callStack, dataPoint, nodeId
        );
    }
}