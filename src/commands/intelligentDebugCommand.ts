import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeAnalyzer } from '../codeAnalyzer';
import { BreakpointManager } from '../breakpointManager';
import { DataCollector } from '../dataCollector';
import { DebugInsightsProvider } from '../treeDataProviders';
import { BreakpointRanker } from '../algorithms/breakPointRanker';

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

    constructor(
        context: vscode.ExtensionContext,
        codeAnalyzer: CodeAnalyzer,
        breakpointManager: BreakpointManager,
        dataCollector: DataCollector,
        debugInsightsProvider: DebugInsightsProvider,
        breakpointRanker: BreakpointRanker
    ) {
        this.context = context;
        this.codeAnalyzer = codeAnalyzer;
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.debugInsightsProvider = debugInsightsProvider;
        this.breakpointRanker = breakpointRanker;
        
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
     * Execute the intelligent debug command
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
                        this.launchDebugger(filePath);
                        return;
                    }
                    
                    // Rank nodes for breakpoints
                    const rankedNodes = this.breakpointRanker.rankNodesForBreakpoints(nodes);
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
                            this.getBreakpointDescription(node)
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
                    this.setupCustomDebugEventHandler();
                    
                    progress.report({ increment: 15, message: "Starting debugger..." });
                    
                    // Step 6: Launch the debugger
                    this.launchDebugger(filePath);
                    
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
                    this.launchDebugger(filePath);
                    this.updateStatusBar('idle');
                }
            }
        );
    }
    
    /**
     * Set up custom debug event handler for better UX
     */
    private setupCustomDebugEventHandler(): void {
        // Register debug adapter tracker with pause behavior
        const trackerDisposable = vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (session: vscode.DebugSession) => {
                console.log(`Creating debug tracker for ${session.type} session ${session.id}`);
                
                return {
                    onWillStartSession: () => {
                        console.log(`Debug session ${session.id} is starting`);
                    },
                    
                    onDidSendMessage: async (message: any) => {
                        // ✅ IMPORTANT: Properly handle stopped events to pause execution
                        if (message.type === 'event') {
                            console.log(`DEBUG EVENT: ${message.event}`);
                            
                            if (message.event === 'stopped') {
                                // Log it clearly
                                console.log(`🛑 BREAKPOINT STOPPED: reason=${message.body?.reason}, threadId=${message.body?.threadId}`);
                                
                                // Update UI
                                this.updateStatusBar('breakpoint');
                                vscode.window.setStatusBarMessage(`🛑 Debugger paused at breakpoint`, 5000);
                                // CRITICAL: Don't do anything that would auto-continue
                                // Just collect data and show notification
                                try {
                                    // Collect debugging data
                                    await this.collectDebugData(session, message);
                                    
                                } catch (error) {
                                    console.error("Error handling breakpoint:", error);
                                }
                            }
                        }
                    },
                    
                    // Add better tracking for all message types
                    onWillReceiveMessage: (message: any) => {
                        // Watch for continue requests to debug the issue
                        if (message.type === 'request' && message.command === 'continue') {
                            console.log(`⚠️ Continue requested for thread ${message.arguments?.threadId}`);
                        }
                    }
                };
            }
        });
        
        this.context.subscriptions.push(trackerDisposable);
    }
    
    /**
     * Collect debugging data when a breakpoint is hit
     */
    private async collectDebugData(session: vscode.DebugSession, message: any): Promise<void> {
        try {
            const threadId = message.body.threadId;
            
            // Get stack frames
            const stackResponse = await session.customRequest('stackTrace', { threadId });
            const stackFrames = stackResponse.stackFrames || [];
            
            if (stackFrames.length === 0) {
                console.log("No stack frames available");
                return;
            }
            
            const topFrame = stackFrames[0];
            const fileName = topFrame.source?.path || 'unknown';
            const lineNumber = topFrame.line || 0;
            
            // Find matching breakpoint
            const matchingBp = this.breakpointManager.getBreakpointAt(
                vscode.Uri.file(fileName),
                lineNumber - 1
            );
            
            // Get variables
            const variables: Record<string, any> = {};
            
            // Get scopes
            const scopesResponse = await session.customRequest('scopes', { frameId: topFrame.id });
            const scopes = scopesResponse.scopes || [];
            
            // Collect variables from each scope
            for (const scope of scopes) {
                if (scope.variablesReference) {
                    const varsResponse = await session.customRequest('variables', {
                        variablesReference: scope.variablesReference
                    });
                    
                    for (const variable of varsResponse.variables || []) {
                        variables[variable.name] = variable.value;
                    }
                }
            }
            
            // Create a call stack representation
            const callStack = stackFrames.map(frame => 
                `${frame.name} (${frame.source?.name || 'unknown'}:${frame.line || 0})`
            );
            
            // Collect data point
            const nodeId = matchingBp?.nodeId || `synthetic_node_${fileName}_${lineNumber}`;
            const dataPoint = await this.dataCollector.collectData(
                matchingBp?.id || `synthetic_bp_${fileName}_${lineNumber}`,
                nodeId,
                variables,
                callStack
            );
            
            // Update debug insights with this information
            this.updateDebugInsightsWithRuntimeData(
                fileName,
                lineNumber,
                variables,
                callStack,
                dataPoint,
                nodeId
            );
            
        } catch (error) {
            console.error("Error collecting debug data:", error);
        }
    }
    
    /**
     * Update the debug insights view with runtime data
     */
   /**
 * Update the debug insights view with runtime data
    */
    private updateDebugInsightsWithRuntimeData(
        fileName: string,
        lineNumber: number,
        variables: Record<string, any>,
        callStack: string[],
        dataPoint: any,
        nodeId: string
    ): void {
        if (!this.debugInsightsProvider) {
            console.warn('Debug insights provider is not available');
            return;
        }
        
        console.log(`Updating debug insights with runtime data - ${Object.keys(variables).length} total variables`);
        
        // Create insights from the data
        const insights = [];
        
        // Add breakpoint location info
        insights.push({
            title: `Breakpoint hit at ${path.basename(fileName)}:${lineNumber}`,
            description: callStack[0] || "Unknown function",
            iconPath: new vscode.ThemeIcon("debug-breakpoint"),
            nodeId
        });
        
        // Filter out Node.js internals and system variables
        const filteredVars = this.filterOutNodeInternals(variables);
        console.log(`After filtering: ${Object.keys(filteredVars).length} variables remain`);
        
        // Get the most informative variables
        const topVars = this.findMostInformativeVariables(filteredVars);
        console.log(`Top variables selected: ${topVars.map(([name]) => name).join(', ')}`);
        
        if (topVars.length > 0) {
            // Add a section header for variables
            insights.push({
                title: "Key Variables",
                description: "Most informative variables at this breakpoint",
                iconPath: new vscode.ThemeIcon("symbol-variable"),
                nodeId
            });
            
            // Add each important variable with context - WITHOUT including the value in the title
            for (const [name, value] of topVars) {
                // Get a short type description for the value
                const typeInfo = this.getShortTypeDescription(value);
                
                insights.push({
                    // Just show the variable name and type, not the full value
                    title: `${name} (${typeInfo})`,
                    // Keep the detailed description about why this variable matters
                    description: this.describeVariableImportance(name, value, variables),
                    iconPath: new vscode.ThemeIcon("symbol-field"),
                    nodeId,
                    // Store the value as a property so it's available when clicking
                    contextValue: 'variable',
                    // Store the actual value for reference when clicked
                    value: value
                });
            }
            
            // Group variables by category if needed
            this.addVariableCategorization(insights, variables, topVars, nodeId);
        } else {
            // If no variables were found after filtering, add a message
            insights.push({
                title: "No application variables found",
                description: "Try setting breakpoints in code with more application-specific variables",
                iconPath: new vscode.ThemeIcon("info"),
                nodeId
            });
        }
        
        // Add execution context and other insights as before...
        
        // Update the view
        this.debugInsightsProvider.refresh(insights);
    }

    /**
     * Get a short description of the variable's type and structure
     */
    private getShortTypeDescription(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        
        if (Array.isArray(value)) {
            return `Array[${value.length}]`;
        }
        
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            return `Object{${keys.length} props}`;
        }
        
        if (typeof value === 'string') {
            return `String(${value.length})`;
        }
        
        if (typeof value === 'number') {
            return 'Number';
        }
        
        if (typeof value === 'boolean') {
            return 'Boolean';
        }
        
        if (typeof value === 'function') {
            return 'Function';
        }
        
        return typeof value;
    }
        
    /**
     * Add categorized variables to insights
     */
    private addVariableCategorization(
        insights: any[], 
        variables: Record<string, any>, 
        topVars: [string, any][],
        nodeId: string
    ): void {
        // Group variables by category
        const categories: Record<string, [string, any][]> = {
            "State Variables": [],
            "Control Variables": [],
            "Data Variables": [],
            "Other Variables": []
        };
        
        // Categorize the top variables
        for (const [name, value] of topVars) {
            if (['i', 'j', 'index', 'count', 'length'].includes(name)) {
                categories["Control Variables"].push([name, value]);
            } else if (['result', 'output', 'data', 'response', 'item'].includes(name)) {
                categories["Data Variables"].push([name, value]);
            } else if (['status', 'state', 'mode', 'flag', 'enabled', 'active'].includes(name)) {
                categories["State Variables"].push([name, value]);
            } else {
                categories["Other Variables"].push([name, value]);
            }
        }
        
        // Only add categories that have variables
        for (const [category, vars] of Object.entries(categories)) {
            if (vars.length > 0) {
                insights.push({
                    title: category,
                    description: `${vars.length} variables related to ${category.toLowerCase()}`,
                    iconPath: new vscode.ThemeIcon("symbol-variable"),
                    nodeId
                });
            }
        }
    }
    
    /**
     * Comprehensive variable filtering function 
     */
    private filterOutNodeInternals(variables: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        
        // Extensive list of Node.js built-ins to filter out
        const builtins = [
            'Buffer', 'process', 'global', 'console', 'module', 'require', 'exports',
            '__dirname', '__filename', 'globalThis', 'clearImmediate', 'clearInterval', 
            'clearTimeout', 'setImmediate', 'setInterval', 'setTimeout',
            'queueMicrotask', 'AbortController', 'AbortSignal', 'atob', 'btoa',
            'Blob', 'crypto', 'fetch', 'BroadcastChannel', 'ByteLengthQueuingStrategy',
            'CompressionStream', 'CountQueuingStrategy', 'Crypto'
        ];
        
        // Filter out built-ins and system variables
        for (const [key, value] of Object.entries(variables)) {
            // Skip if it's in our list or starts with special characters
            if (builtins.includes(key) || key.startsWith('__') || key === 'this') {
                continue;
            }
            
            // Skip functions with certain patterns that suggest Node.js internals
            if (typeof value === 'string' && 
                value.startsWith('f ') && 
                (value.includes('mod ??= require(id)') || 
                value.includes('lazyLoadedValue'))) {
                continue;
            }
            
            // Keep this variable
            result[key] = value;
        }
        
        console.log(`DEBUG: Filtered ${Object.keys(variables).length} variables down to ${Object.keys(result).length}`);
        return result;
    }
        
    public findMostInformativeVariables(variables: Record<string, any>): [string, any][] {
        const varEntries = Object.entries(variables);
        
        // Sort by potential informativeness (improved algorithm)
        const scoredVars = varEntries.map(([name, value]) => {
            let score = 0;
            
            // Give highest priority to processed/transformed data variables
            if (name === 'processedUser' || name.includes('processed') || name.includes('transformed')) {
                score += 10;  // Highest priority
            }
            
            // User data variables are highly valuable
            else if (name.includes('user') || name.includes('data') || name.includes('options')) {
                score += 5;
            }
            
            // Variables that often indicate state
            if (['i', 'j', 'index', 'key', 'count'].includes(name)) score += 3;
            if (['value', 'result', 'sum', 'total'].includes(name)) score += 4;
            if (['error', 'exception', 'status'].includes(name)) score += 5;
            
            // Complex objects may be more informative
            if (typeof value === 'object' && value !== null) score += 2;
            
            // Arrays with content
            if (Array.isArray(value) && value.length > 0) score += 3;
            
            // Context-related variables are often important
            if (name.startsWith('ctx') || name.includes('context')) score += 3;
            
            // Input/output variables
            if (name.includes('input') || name.includes('output')) score += 4;
            
            // Almost certainly user-defined variables with short names
            if (name.length < 4 && !['id', 'key', 'val', 'err', 'req', 'res'].includes(name)) score += 2;
            
            return { name, value, score };
        });
        
        // Log the scores for debugging
        console.log('Variable scores:', scoredVars.map(v => `${v.name}: ${v.score}`).join(', '));
        
        // Sort by score (highest first) and take top 5
        return scoredVars
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)  // Increased to 6 to make room for processedUser
            .map(({ name, value }) => [name, value]);
    }
        /**
     * Create a description of why a variable is important
     */
    private describeVariableImportance(
        name: string, 
        value: any, 
        allVariables: Record<string, any>
    ): string {
        // Loop counters and control variables
        if (['i', 'j', 'index', 'idx'].includes(name)) {
            return "Loop counter/index variable controlling iteration progress";
        }
        
        // Processed data
        if (name.includes('processed') || name.includes('transformed')) {
            return "Contains transformed data after processing - key to understanding function output";
        }
        
        // Accumulation variables
        if (['sum', 'total', 'result', 'accumulated'].includes(name)) {
            return "Accumulator variable tracking computation progress and final results";
        }
        
        // Error tracking
        if (['error', 'err', 'exception', 'ex'].includes(name)) {
            return "Error tracking variable - critical for understanding failure paths";
        }
        
        // User data
        if (name.includes('user')) {
            return "User data being processed - core business logic depends on this";
        }
        
        // Configuration and options
        if (name.includes('options') || name.includes('config')) {
            return "Configuration options affecting execution behavior and logic paths";
        }
        
        // Arrays
        if (Array.isArray(value)) {
            return `Collection being processed - contains ${value.length} elements that drive logic flow`;
        }
        
        // Objects
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            const keyList = keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
            return `Complex data structure with ${keys.length} properties (${keyList}) - central to function operation`;
        }
        
        // Flag variables
        if (typeof value === 'boolean') {
            return "Control flag that determines conditional logic paths";
        }
        
        return "Contextual variable affecting program flow at this breakpoint";
    }
        
    /**
     * Create a description for an intelligent breakpoint
     */
    private getBreakpointDescription(node: any): string {
        // Use your analysis to describe why this breakpoint is important
        // This is a simplified version
        
        if (node.metadata.isCritical) {
            return "Critical code path - important for program correctness";
        }
        
        if (node.metadata.isLoop) {
            return "Loop entry point - good for tracking iterations";
        }
        
        if (node.metadata.isBranch) {
            return "Branch condition - determines execution path";
        }
        
        if (node.metadata.isErrorHandling) {
            return "Error handling code - helps diagnose failures";
        }
        
        if (node.metadata.semanticComplexity && node.metadata.semanticComplexity > 2) {
            return "Complex code section - high cognitive complexity";
        }
        
        if (node.metadata.potentialBugs && node.metadata.potentialBugs.length > 0) {
            return `Potential issue: ${node.metadata.potentialBugs[0]}`;
        }
        
        return "Intelligent breakpoint based on code analysis";
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
     * Launch the debugger for the given file
     */
    private launchDebugger(filePath: string): void {
        // Get file extension to determine debug type
        const ext = path.extname(filePath).toLowerCase();
        
        // Create appropriate debug configuration
        const config: any = {
            name: "Intelligent Debug Session",
            request: "launch",
            skipFiles: ["<node_internals>/**"],
            program: filePath,
            // ✅ CRITICAL: Make sure these options are set correctly
            noDebug: false,           // Must be false to enable breakpoints
            stopOnEntry: true,        // Stop at program start
            internalConsoleOptions: "openOnSessionStart" // Show debug console
        };
        
        // Set debug type based on file extension
        if (['.ts', '.tsx'].includes(ext)) {
            config.type = "node";
            config.runtimeArgs = ["-r", "ts-node/register"];
            config.sourceMaps = true;
        } else {
            config.type = "node";
        }
        
        // Add these lines for debugging:
        console.log("Starting debug session with config:", config);
        
        // Start debugging with the correct configuration
        vscode.debug.startDebugging(undefined, config);
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
}