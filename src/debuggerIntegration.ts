import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BreakpointManager, IntelligentBreakpoint } from './breakpointManager';
import { DataCollector } from './dataCollector';
import { ConversationalPrompts } from './conversationalPrompts';
import { InformationGainAnalyzer } from './informationGain';
import { CausalAnalysis, RootCause } from './causalAnalysis';
import { LLMService } from './llmService';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from './treeDataProviders';
import { CodeAnalyzer } from './codeAnalyzer';


export class DebuggerIntegration implements vscode.Disposable {
    private breakpointManager: BreakpointManager;
    private dataCollector: DataCollector;
    private disposables: vscode.Disposable[] = [];
    private activeBreakpoints: Map<string, vscode.Breakpoint> = new Map();
    private promptManager: ConversationalPrompts;
    private infoGainAnalyzer: InformationGainAnalyzer;
    private causalAnalyzer: CausalAnalysis;
    private llmService: LLMService;
    private codeAnalyzer: CodeAnalyzer;
    private breakpointsProvider?: BreakpointsProvider;
    private rootCauseProvider?: RootCauseProvider;
    private fixSuggestionsProvider?: FixSuggestionsProvider;
    private debugInsightsProvider?: DebugInsightsProvider;
    
    // Project-wide analysis support
    private projectFiles: Map<string, string> = new Map();
    private analyzedFiles: Set<string> = new Set();

    constructor(
        breakpointManager: BreakpointManager, 
        dataCollector: DataCollector,
        causalAnalyzer?: CausalAnalysis,
        infoGainAnalyzer?: InformationGainAnalyzer,
        llmService?: LLMService
    ) {
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.llmService = llmService || new LLMService();
        this.promptManager = new ConversationalPrompts(undefined, this.llmService);
        this.infoGainAnalyzer = infoGainAnalyzer || new InformationGainAnalyzer(dataCollector);
        this.causalAnalyzer = causalAnalyzer || new CausalAnalysis(dataCollector, this.llmService);
        this.codeAnalyzer = this.breakpointManager.getCodeAnalyzer();
    }
    
    public setTreeProviders(
        breakpointsProvider: BreakpointsProvider,
        rootCauseProvider: RootCauseProvider,
        fixSuggestionsProvider: FixSuggestionsProvider,
        debugInsightsProvider?: DebugInsightsProvider
    ): void {
        this.breakpointsProvider = breakpointsProvider;
        this.rootCauseProvider = rootCauseProvider;
        this.fixSuggestionsProvider = fixSuggestionsProvider;
        this.debugInsightsProvider = debugInsightsProvider;
    }

    public registerEventHandlers(): void {
        // Register debug session event handlers
        this.disposables.push(
            vscode.debug.onDidStartDebugSession(this.handleDebugSessionStart.bind(this)),
            vscode.debug.onDidTerminateDebugSession(this.handleDebugSessionEnd.bind(this)),
            vscode.debug.onDidChangeBreakpoints(this.handleBreakpointsChange.bind(this))
        );
    }
    
    private async handleDebugSessionStart(session: vscode.DebugSession): Promise<void> {
        console.log(`🔄 Debug session started: ${session.type} (ID: ${session.id})`);
        
        // Clear previous data when starting a new debug session
        this.dataCollector.clearData();
        
        // Set our intelligent breakpoints with better logging
        const breakpoints = this.breakpointManager.getAllBreakpoints();
        console.log(`Setting ${breakpoints.length} intelligent breakpoints`);
        
        for (const bp of breakpoints) {
            console.log(`Setting breakpoint at ${bp.uri.fsPath}:${bp.line + 1} (ID: ${bp.id})`);
            await this.setVSCodeBreakpoint(bp);
        }
        
        // Get the current breakpoints to verify they're set
        const activeBreakpoints = vscode.debug.breakpoints;
        console.log(`Active VS Code breakpoints: ${activeBreakpoints.length}`);
        for (const bp of activeBreakpoints) {
            if (bp instanceof vscode.SourceBreakpoint) {
                console.log(`Active breakpoint: ${bp.location.uri.fsPath}:${bp.location.range.start.line + 1}`);
            }
        }
        
        // ✅ IMPORTANT: Register ALL possible event handlers for the debug session
        this.disposables.push(
            // Register for direct debug events from VS Code
            vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
                console.log(`Debug custom event: ${e.event}`, e.body);
            }),
            
            // Monitor stopped events directly
            vscode.debug.onDidChangeBreakpoints(e => {
                console.log(`Breakpoints changed: ${e.added.length} added, ${e.removed.length} removed, ${e.changed.length} changed`);
            }),
            
            // Monitor active debug sessions
            vscode.debug.onDidStartDebugSession(s => {
                if (s.id !== session.id) {
                    console.log(`New debug session started: ${s.id}`);
                }
            }),
            
            // Register comprehensive debug adapter tracker
            vscode.debug.registerDebugAdapterTrackerFactory('*', {
                createDebugAdapterTracker: (trackerSession: vscode.DebugSession) => {
                    console.log(`Creating debug tracker for ${trackerSession.type} session ${trackerSession.id}`);
                    
                    return {
                        onWillStartSession: () => {
                            console.log(`Debug session ${trackerSession.id} is starting`);
                        },
                        
                        onDidSendMessage: async (message: any) => {
                            // 🔍 Log ALL message types to diagnose the issue
                            console.log(`DEBUG MESSAGE [${message.type}]: ${message.event || message.command || 'unknown'}`);
                            
                            // Specifically look for stop events
                            if (message.type === 'event' && message.event === 'stopped') {
                                console.log(`🔴 BREAKPOINT STOPPED: reason=${message.body?.reason}, threadId=${message.body?.threadId}`);
                                
                                // Add a notification so it's clearly visible
                                const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
                                statusBarItem.text = `$(debug-breakpoint) Breakpoint: ${message.body?.reason || 'Hit'}`;
                                statusBarItem.tooltip = "CoDebugger is analyzing this breakpoint";
                                statusBarItem.show();

                                // Hide after 3 seconds
                                setTimeout(() => statusBarItem.hide(), 3000);
                                
                                try {
                                    await this.handleBreakpointHit(trackerSession, message);
                                } catch (error) {
                                    console.error('Error in breakpoint handler:', error);
                                }
                            }
                            
                            // Track other important events
                            if (message.type === 'event') {
                                if (['breakpoint', 'initialized', 'terminated'].includes(message.event)) {
                                    console.log(`Important debug event: ${message.event}`, message.body);
                                }
                            }
                            
                            // Track request results related to breakpoints and variables
                            if (message.type === 'response') {
                                if (['setBreakpoints', 'configurationDone'].includes(message.command)) {
                                    console.log(`Response to ${message.command}:`, message.body);
                                }
                            }
                        },
                        
                        onWillReceiveMessage: (message: any) => {
                            // Only log key requests to reduce noise
                            if (message.type === 'request' && 
                                ['setBreakpoints', 'configurationDone', 'initialize'].includes(message.command)) {
                                console.log(`Debug request: ${message.command}`);
                            }
                        }
                    };
                }
            })
        );
        
        // Show message to confirm debugger is ready
        vscode.window.showInformationMessage(
            'co-debugger-ai active: Run your code to start debugging.'
        );
    }
    private async handleDebugSessionEnd(session: vscode.DebugSession): Promise<void> {
        console.log("Debug session ended, analyzing data...");
        
        // Clean up hover providers
        this.clearBreakpointHovers();
        
        // Immediately update the breakpoints tree with what we have
        if (this.breakpointsProvider) {
            const breakpoints = this.breakpointManager.getAllBreakpoints();
            this.breakpointsProvider.refresh(breakpoints.map(bp => ({
                location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                reason: bp.reason,
                score: bp.score
            })));
        }
        
        // When debugging ends, analyze the collected data
        await this.analyzeDebugData();
        
        console.log("Analysis complete, updating UI...");
        
        // REMOVED: The following code that was creating and showing the debug insights panel
        // const { DebugInsightsPanel } = require('./views/debugInsightsPanel');
        // DebugInsightsPanel.createOrShow(vscode.extensions.getExtension('your-extension-id')?.extensionUri || vscode.Uri.file(''), false);
        // const insightsHTML = await this.generateDebugInsightsHTML();
        // DebugInsightsPanel.updateContent(insightsHTML);
        
        // Optional: Show a status bar notification that insights are available
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBar.text = "$(info) Debug insights available";
        statusBar.tooltip = "Click to view debug insights";
        statusBar.command = 'intelligent-debugger.viewInsights'; // This command should be registered elsewhere to show the panel
        statusBar.show();
        
        // Hide the notification after 10 seconds
        setTimeout(() => statusBar.dispose(), 10000);
    }

  /**
 * Generate meaningful debug insights using LLM
 */
private async generateDebugInsightsHTML(): Promise<string> {
    const allSeries = this.dataCollector.getAllDataSeries();
    
    // If no data, show simple message
    if (allSeries.length === 0 || !allSeries.some(s => s.data.length > 0)) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Debug Insights</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                    }
                    h1 {
                        color: var(--vscode-editor-foreground);
                    }
                </style>
            </head>
            <body>
                <h1>Debug Insights</h1>
                <p>No debug data was collected during this session. Try setting breakpoints in key areas of your code.</p>
            </body>
            </html>`;
    }
    
    // Start building enhanced HTML content with better styling
    let insightsContent = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Debug Insights</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    line-height: 1.5;
                }
                h1, h2, h3 {
                    color: var(--vscode-editor-foreground);
                }
                .insight-card {
                    margin-bottom: 20px;
                    padding: 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }
                .location-tag {
                    font-size: 12px;
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 3px 8px;
                    border-radius: 20px;
                    display: inline-block;
                    margin-bottom: 10px;
                }
                .insight-explanation {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 12px;
                    border-radius: 4px;
                    margin: 10px 0;
                }
                .code-block {
                    font-family: monospace;
                    background-color: var(--vscode-editor-background);
                    padding: 8px 12px;
                    border-radius: 4px;
                    overflow-x: auto;
                }
                .anomaly-badge {
                    background-color: var(--vscode-errorForeground);
                    color: white;
                    padding: 3px 8px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: bold;
                    display: inline-block;
                    margin-left: 8px;
                }
                .variable-list {
                    display: none;
                }
                .toggle-button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-top: 10px;
                    font-size: 12px;
                }
                .toggle-button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .variable-name {
                    color: var(--vscode-symbolIcon-variableForeground);
                    font-weight: bold;
                }
                .variable-value {
                    font-family: monospace;
                    padding: 2px 4px;
                    background-color: var(--vscode-editor-background);
                    border-radius: 3px;
                }
                .variable-value-complex {
                    white-space: pre;
                    overflow-x: auto;
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 8px;
                    background-color: var(--vscode-editor-background);
                    border-radius: 3px;
                    margin: 5px 0;
                }
            </style>
        </head>
        <body>
            <h1>Debug Insights</h1>
            <p>AI-enhanced understanding of your debugging session:</p>
    `;
    
    try {
        // Generate LLM insights for each significant breakpoint
        let insightCards = '';
        let insightPromises = [];
        
        for (const series of allSeries) {
            if (series.data.length === 0) continue;
            
            // Get the most recent data point
            const lastPoint = series.data[series.data.length - 1];
            
            // Skip if there are no variables
            if (!lastPoint.variables || lastPoint.variables.length === 0) continue;
            
            // Prepare context for LLM
            const breakpointInfo = this.findBreakpointById(series.breakpointId);
            if (!breakpointInfo) continue;
            
            const fileName = breakpointInfo.uri.fsPath.split('/').pop() || 'unknown';
            const lineNumber = breakpointInfo.line + 1;
            
            // Get the code snippet if available
            let codeSnippet = '';
            try {
                const document = await vscode.workspace.openTextDocument(breakpointInfo.uri);
                // Get a few lines before and after
                const startLine = Math.max(0, breakpointInfo.line - 3);
                const endLine = Math.min(document.lineCount - 1, breakpointInfo.line + 3);
                
                for (let i = startLine; i <= endLine; i++) {
                    const lineText = document.lineAt(i).text;
                    if (i === breakpointInfo.line) {
                        codeSnippet += `> ${lineText}\n`; // Highlight the breakpoint line
                    } else {
                        codeSnippet += `  ${lineText}\n`;
                    }
                }
            } catch (err) {
                // If we can't access the file, just continue
                codeSnippet = "Code not available";
            }
            
            // Format variables for the LLM - IMPROVED FORMAT
            const formattedVariables = this.formatVariablesForDisplay(lastPoint.variables);
            
            // Create a promise for this LLM insight
            const insightPromise = this.llmService.generateDebugInsight(
                    fileName, 
                    lineNumber, 
                    codeSnippet, 
                    formattedVariables.plainText, // Plain text for LLM
                    lastPoint.callStack || []
                )
                .then(insight => {
                    // Create the insight card HTML
                    return `
                    <div class="insight-card">
                        <div class="location-tag">
                            ${fileName}:${lineNumber}
                        </div>
                        
                        ${lastPoint.anomalyScore && lastPoint.anomalyScore > 1.0 ? 
                            `<span class="anomaly-badge">Anomaly Detected</span>` : ''}
                            
                        <h2>What's happening here</h2>
                        
                        <div class="insight-explanation">
                            ${insight.explanation}
                        </div>
                        
                        ${insight.keyVariables ? `
                        <h3>Important Variables</h3>
                        <ul>
                            ${insight.keyVariables.map(v => `<li><span class="variable-name">${v.name}</span>: ${v.explanation}</li>`).join('')}
                        </ul>` : ''}
                        
                        ${insight.potentialIssues ? `
                        <h3>Potential Issues</h3>
                        <ul>
                            ${insight.potentialIssues.map(issue => `<li>${issue}</li>`).join('')}
                        </ul>` : ''}
                        
                        <div class="code-block">
                            <pre>${this.escapeHtml(codeSnippet)}</pre>
                        </div>
                        
                        <button class="toggle-button" onclick="document.getElementById('vars-${series.breakpointId}').style.display = document.getElementById('vars-${series.breakpointId}').style.display === 'none' ? 'block' : 'none';">
                            Show Current Variables
                        </button>
                        
                        <div id="vars-${series.breakpointId}" class="variable-list">
                            <h4>Current Variable Values:</h4>
                            ${formattedVariables.html}
                        </div>
                    </div>`;
                })
                .catch(err => {
                    console.error('Error generating insight:', err);
                    // Fallback to direct variable display if the LLM fails
                    return `
                    <div class="insight-card">
                        <div class="location-tag">
                            ${fileName}:${lineNumber}
                        </div>
                        
                        <h2>Variables at this breakpoint</h2>
                        
                        <p>Unable to generate AI insights. Here are the raw variables:</p>
                        
                        <div class="code-block">
                            <pre>${this.escapeHtml(codeSnippet)}</pre>
                        </div>
                        
                        ${formattedVariables.html}
                    </div>`;
                });
                
            insightPromises.push(insightPromise);
        }
        
        // Wait for all LLM insights to complete
        const insightResults = await Promise.all(insightPromises);
        insightCards = insightResults.join('');
        
        // Add the insight cards to the HTML
        insightsContent += insightCards;
        
        // If we didn't generate any insights, provide a fallback message
        if (!insightCards) {
            insightsContent += `
                <div class="insight-card">
                    <h2>No significant insights detected</h2>
                    <p>Try setting breakpoints in more relevant parts of your code to get better insights.</p>
                </div>`;
        }
        
    } catch (error) {
        // Handle errors gracefully
        console.error('Error generating debug insights:', error);
        insightsContent += `
            <div class="insight-card">
                <h2>Error generating insights</h2>
                <p>There was a problem analyzing your debug data: ${error.message}</p>
                <p>Try again or set breakpoints in different locations.</p>
            </div>`;
    }
    
    // Close HTML content
    insightsContent += `
        <script>
            // Simple toggle function for raw variables
            function toggleVariables(id) {
                const elem = document.getElementById(id);
                elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
            }
        </script>
        </body>
        </html>`;
    
    return insightsContent;
}

/**
 * Format variables for display in a user-friendly way
 * Returns both HTML and plain text formats
 */
private formatVariablesForDisplay(variables: any[]): { html: string, plainText: string } {
    if (!variables || variables.length === 0) {
        return { 
            html: '<div>No variables collected</div>', 
            plainText: 'No variables collected' 
        };
    }
    
    let html = '<div>';
    let plainText = '';
    
    // Filter out internal Node.js variables that aren't interesting for debugging
    const filteredVariables = variables.filter(v => {
        const name = v.name || '';
        // Skip Node.js internals and module system variables that clutter the output
        return !name.startsWith('_') && 
               !['module', 'exports', 'require', 'Buffer', 'process', 'clearImmediate',
                'clearInterval', 'clearTimeout', 'setImmediate', 'setInterval', 'setTimeout',
                'global', 'console'].includes(name);
    });
    
    // If we've filtered everything out, show a subset of the original
    const varsToShow = filteredVariables.length > 0 ? filteredVariables : variables.slice(0, 5);
    
    for (const variable of varsToShow) {
        const name = variable.name || 'unnamed';
        let valueStr = '';
        
        // Format the value based on its type
        if (variable.value === undefined || variable.value === null) {
            valueStr = String(variable.value);
        } else if (typeof variable.value === 'function') {
            // For functions, just show a shortened signature
            const funcStr = String(variable.value);
            const firstLine = funcStr.split('\n')[0].trim();
            const shortened = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
            valueStr = shortened;
        } else if (typeof variable.value === 'object') {
            try {
                // Try to pretty format objects
                const stringified = JSON.stringify(variable.value, null, 2);
                if (stringified === '{}') {
                    valueStr = '{}'; // Empty object
                } else if (stringified === '[]') {
                    valueStr = '[]'; // Empty array
                } else if (stringified !== undefined) {
                    // If stringification worked, use it with proper formatting
                    valueStr = stringified;
                } else {
                    // Fallback if stringification fails
                    valueStr = this.safeToString(variable.value);
                }
            } catch (e) {
                // If JSON stringification fails, use a simpler approach
                valueStr = this.safeToString(variable.value);
            }
        } else {
            // For primitives, use the value directly
            valueStr = String(variable.value);
        }
        
        // For HTML output
        if (valueStr.length > 100 || valueStr.includes('\n')) {
            // For complex values, use a pre block
            html += `<div>
                <span class="variable-name">${this.escapeHtml(name)}</span>
                <pre class="variable-value-complex">${this.escapeHtml(valueStr)}</pre>
            </div>`;
        } else {
            // For simple values
            html += `<div>
                <span class="variable-name">${this.escapeHtml(name)}</span>: 
                <span class="variable-value">${this.escapeHtml(valueStr)}</span>
            </div>`;
        }
        
        // For plain text output (used for LLM)
        plainText += `${name}: ${valueStr}\n`;
    }
    
    html += '</div>';
    return { html, plainText };
}

/**
 * Safe toString implementation for values that might throw when stringified
 */
private safeToString(value: any): string {
    try {
        // For simple objects, try Object.entries
        if (typeof value === 'object' && value !== null) {
            const entries = Object.entries(value);
            if (entries.length === 0) return '{}';
            
            const props = entries.map(([k, v]) => {
                // Handle nested values safely
                let valueStr = typeof v === 'object' && v !== null ? '[Object]' : String(v);
                // Truncate long strings
                if (typeof valueStr === 'string' && valueStr.length > 50) {
                    valueStr = valueStr.substring(0, 50) + '...';
                }
                return `${k}: ${valueStr}`;
            });
            
            return `{ ${props.join(', ')} }`;
        }
        
        // Handle arrays specially
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            if (value.length > 5) {
                return `[Array(${value.length})]`;
            }
            return `[${value.map(item => typeof item === 'object' ? '[Object]' : String(item)).join(', ')}]`;
        }
        
        return String(value);
    } catch (e) {
        return `[Object (toString failed)]`;
    }
}
    /**
     * Find a breakpoint by its ID
     */
    private findBreakpointById(id: string): IntelligentBreakpoint | undefined {
        return this.breakpointManager.getBreakpointById(id);
    }

            
    private async handleBreakpointsChange(event: vscode.BreakpointsChangeEvent): Promise<void> {
        // Handle manually added/removed breakpoints
        // We could integrate user-added breakpoints into our analysis
    }
    
    private async handleBreakpointHit(session: vscode.DebugSession, message: any): Promise<void> {
        console.log("Breakpoint hit detected:", message.body?.threadId);
        
        // A breakpoint was hit - let's collect data
        try {
            // Get the current stack frame
            const threadId = message.body.threadId;
            console.log("Thread ID:", threadId);
            
            // 🔧 Add a delay to ensure VS Code's debug UI has updated
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Get stack frames with error handling
            let stackFrames = [];
            try {
                const response = await session.customRequest('stackTrace', { threadId });
                stackFrames = response.stackFrames || [];
                console.log("Stack frames count:", stackFrames.length);
                
                // Analyze any files in the current call stack that haven't been analyzed yet
                await this.analyzeCallStackFiles(stackFrames);
                
            } catch (stackError) {
                console.error("Error getting stack frames:", stackError);
                // Create a minimal frame if needed
                stackFrames = [{
                    id: 0,
                    name: "Unknown",
                    line: 0,
                    column: 0,
                    source: { name: "unknown", path: "unknown" }
                }];
            }
            
            if (stackFrames.length === 0) {
                console.log("No stack frames available, using fallback");
                // Use a fallback frame
                stackFrames = [{
                    id: 0,
                    name: "Unknown",
                    line: 0,
                    column: 0,
                    source: { name: "unknown", path: "unknown" }
                }];
            }
            
            const topFrame = stackFrames[0];
            const fileName = topFrame.source?.path || 'unknown';
            const lineNumber = topFrame.line || 0;
            
            console.log(`Hit at ${fileName}:${lineNumber}`);
            
            // Find our intelligent breakpoint at this location
            const matchingBp = this.findBreakpointAtLocation(fileName, lineNumber);
            console.log("Matching breakpoint:", matchingBp ? matchingBp.id : "None");
            
            // 🔧 Even if no matching breakpoint, collect data anyway
            const actualFrameId = topFrame.id;
            
            // Get variables with better error handling
            let variables = {};
            try {
                // Get scopes
                let scopes = [];
                try {
                    const scopesResponse = await session.customRequest('scopes', { frameId: actualFrameId });
                    scopes = scopesResponse.scopes || [];
                    console.log("Scopes found:", scopes.length);
                } catch (scopeError) {
                    console.error("Error getting scopes:", scopeError);
                }
                
                // 🔍 Try multiple approaches to get variables
                if (scopes.length > 0) {
                    variables = await this.getVariables(session, scopes, actualFrameId);
                } else {
                    // Try direct evaluation of common variables
                    variables = await this.getVariablesByEvaluation(session, actualFrameId);
                }
            } catch (varError) {
                console.error("Error collecting variables:", varError);
            }
            
            console.log("Variables collected:", Object.keys(variables));
            
            // Convert stack frames to strings for the call stack
            const callStack = stackFrames.map(frame => 
                `${frame.name} (${frame.source?.name || 'unknown'}:${frame.line || 0})`
            );
            
            // 🔧 Create a synthetic breakpoint if needed
            const breakpointId = matchingBp ? matchingBp.id : `synthetic_bp_${fileName}_${lineNumber}`;
            const nodeId = matchingBp ? matchingBp.nodeId : `synthetic_node_${fileName}_${lineNumber}`;
            
            // Collect the data
            const dataPoint = await this.dataCollector.collectData(
                breakpointId,
                nodeId,
                variables,
                callStack
            );
            console.log("Data point collected:", dataPoint ? "success" : "failed");
            
            // Update the debug insights view in real-time
            this.updateDebugInsights(fileName, lineNumber, variables, callStack, dataPoint);
            
            // Process any other breakpoint handlers
            if (matchingBp) {
                // Your existing code for matchingBp...
            }
        } catch (error) {
            console.error('Error handling breakpoint hit:', error);
        }
    }
    
    /**
     * Analyze files in the current call stack that haven't been analyzed yet
     */
    private async analyzeCallStackFiles(stackFrames: any[]): Promise<void> {
        for (const frame of stackFrames) {
            if (frame.source?.path && !this.analyzedFiles.has(frame.source.path)) {
                try {
                    console.log(`Analyzing new file in call stack: ${frame.source.path}`);
                    const fileContent = await fs.readFile(frame.source.path, 'utf8');
                    await this.codeAnalyzer.analyzeCode(fileContent, frame.source.path);
                    this.analyzedFiles.add(frame.source.path);
                    this.projectFiles.set(frame.source.path, fileContent);

                    // Find related files through imports/requires
                    await this.discoverRelatedFiles(frame.source.path, fileContent);
                } catch (error) {
                    console.log(`Could not analyze file in call stack: ${frame.source.path}`);
                }
            }
        }
    }

    /**
     * Discover related files through imports/requires
     */
    private async discoverRelatedFiles(filePath: string, content: string): Promise<void> {
        try {
            // Match different import patterns (customize based on language)
            const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
            const requireRegex = /require\s*\(\s*['"](.+?)['"]\s*\)/g;
            
            const dependencies = [];
            let match;
            
            // Find imports
            while ((match = importRegex.exec(content)) !== null) {
                dependencies.push(this.resolveImportPath(filePath, match[1]));
            }
            
            // Find requires
            while ((match = requireRegex.exec(content)) !== null) {
                dependencies.push(this.resolveImportPath(filePath, match[1]));
            }
            
            // Process discovered files (up to 3 levels deep to avoid too much processing)
            for (const depPath of dependencies) {
                if (!depPath || this.analyzedFiles.has(depPath) || !depPath.endsWith('.js') && !depPath.endsWith('.ts')) {
                    continue;
                }
                
                try {
                    // Only analyze files that exist and are JavaScript/TypeScript
                    const stats = await fs.stat(depPath);
                    if (stats.isFile()) {
                        console.log(`Analyzing related file: ${depPath}`);
                        const depContent = await fs.readFile(depPath, 'utf8');
                        await this.codeAnalyzer.analyzeCode(depContent, depPath);
                        this.analyzedFiles.add(depPath);
                        this.projectFiles.set(depPath, depContent);
                    }
                } catch (error) {
                    // Skip files that don't exist or can't be accessed
                }
            }
        } catch (error) {
            console.error(`Error discovering related files for ${filePath}:`, error);
        }
    }

    /**
     * Resolve import path to absolute path
     */
    private resolveImportPath(sourceFile: string, importPath: string): string | null {
        // Handle built-in modules
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
            return null; // Skip built-in modules
        }
        
        try {
            // Convert relative path to absolute
            const basePath = path.dirname(sourceFile);
            const resolvedPath = path.resolve(basePath, importPath);
            
            // Try to resolve with common extensions if no extension specified
            if (!path.extname(resolvedPath)) {
                for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
                    const pathWithExt = `${resolvedPath}${ext}`;
                    try {
                        if (fs.stat(pathWithExt)) {
                            return pathWithExt;
                        }
                    } catch {
                        // File doesn't exist with this extension, try next
                    }
                }
                
                // Check if it's a directory with an index file
                for (const indexFile of ['index.js', 'index.ts', 'index.jsx', 'index.tsx']) {
                    const indexPath = path.join(resolvedPath, indexFile);
                    try {
                        if (fs.stat(indexPath)) {
                            return indexPath;
                        } 
                    } catch {
                        // Index file doesn't exist, try next
                    }
                }
            }
            
            return resolvedPath;
        } catch {
            return null;
        }
    }

    /**
     * Get project context for a file
     */
    public getProjectContext(filePath: string): Map<string, string> {
        const context = new Map<string, string>();
        
        // Add up to 3 most relevant files from the project context
        let count = 0;
        for (const [path, content] of this.projectFiles) {
            if (count >= 3 || path === filePath) continue;
            
            // Prioritize files that are imported by or import the current file
            const fileContent = this.projectFiles.get(filePath) || '';
            const importedByCurrentFile = 
                new RegExp(`from\\s+['"](.*${path.split('/').pop()})['"']`, 'g').test(fileContent) ||
                new RegExp(`require\\s*\\(\\s*['"](.*${path.split('/').pop()})['"']\\s*\\)`, 'g').test(fileContent);
                
            const importsCurrentFile = 
                new RegExp(`from\\s+['"](.*${filePath.split('/').pop()})['"']`, 'g').test(content) ||
                new RegExp(`require\\s*\\(\\s*['"](.*${filePath.split('/').pop()})['"']\\s*\\)`, 'g').test(content);
                
            if (importedByCurrentFile || importsCurrentFile) {
                context.set(path, content);
                count++;
            }
        }
        
        // If we didn't fill our quota with directly related files, add other files
        if (count < 3) {
            for (const [path, content] of this.projectFiles) {
                if (count >= 3 || path === filePath || context.has(path)) continue;
                context.set(path, content);
                count++;
            }
        }
        
        return context;
    }
    
    // 🆕 New helper method for getting variables through evaluation
    private async getVariablesByEvaluation(session: vscode.DebugSession, frameId: number): Promise<any> {
        const variables: any = {};
        
        console.log("Getting variables through direct evaluation");
        
        // Try to evaluate common variable names
        const commonVars = [
            // Built-in objects
            'this', 'global', 'window', 'document', 
            // Common variable names
            'i', 'j', 'k', 'index', 'value', 'result', 'data', 'item', 'items',
            'array', 'list', 'map', 'obj', 'object', 'options', 'config', 'params',
            'callback', 'handler', 'error', 'err', 'e', 'ex', 'exception',
            'response', 'res', 'req', 'request', 'input', 'output',
            // Function parameters in your test code
            'userOptions', 'numbers', 'testArray', 'input'
        ];
        
        for (const varName of commonVars) {
            try {
                const response = await session.customRequest('evaluate', {
                    expression: varName,
                    frameId: frameId,
                    context: 'watch'
                });
                
                if (response.result !== undefined) {
                    console.log(`Evaluated ${varName} = ${response.result}`);
                    variables[varName] = this.parseVariableValue({ name: varName, value: response.result });
                }
            } catch (evalError) {
                // Silently ignore evaluation errors for variables that don't exist
            }
        }
        
        return variables;
    }
    private updateDebugInsights(
        fileName: string, 
        lineNumber: number, 
        variables: Record<string, any>, 
        callStack: string[], 
        dataPoint: any
    ): void {
        console.log("DebuggerIntegration.updateDebugInsights DISABLED");
        return; 
        if (!this.debugInsightsProvider) return;
        
        console.log("💡 DebuggerIntegration.updateDebugInsights called");
        
        // Create a unique ID for this update
        const updateId = Date.now() + Math.random().toString(36).substring(2, 9);
        console.log(`Debug update ${updateId} scheduled`);
        
        // Store a copy of the variables to prevent them from being modified
        const variablesCopy = {...variables};
        
        // Use the timeout to delay the update
        setTimeout(() => {
            console.log(`Debug update ${updateId} executing`);
            
            // Create insightData INSIDE the timeout
            const insightData = [];
            
            // Add breakpoint location info
            insightData.push({
                title: `Breakpoint hit at ${fileName.split('/').pop()}:${lineNumber}`,
                description: `Call stack: ${callStack[0] || 'Main'}`,
                iconPath: new vscode.ThemeIcon("debug-breakpoint")
            });
            
            // Filter variables from our immutable copy
            const filteredVariables = this.filterOutNodeInternals(variablesCopy);
            console.log(`After filtering: ${Object.keys(filteredVariables).length} variables remain`);
            
            // Find the most informative variables
            const topVars = this.findMostInformativeVariables(filteredVariables);
            console.log(`Top variables selected: ${topVars.map(([name]) => name).join(', ') || 'NONE'}`);
            
            if (topVars.length > 0) {
                // Add a section header for variables
                insightData.push({
                    title: "Key Variables",
                    description: "Most informative variables at this breakpoint",
                    iconPath: new vscode.ThemeIcon("symbol-variable")
                });
                
                // Add each important variable with context
                for (const [name, value] of topVars) {
                    insightData.push({
                        title: `${name} = ${value}`,
                        description: this.describeVariableImportance(name, value),
                        iconPath: new vscode.ThemeIcon("symbol-field")
                    });
                }
            } else {
                // If no variables were found after filtering, add a message
                insightData.push({
                    title: "No application variables found",
                    description: "Try setting breakpoints in code with more application-specific variables",
                    iconPath: new vscode.ThemeIcon("info")
                });
            }
            
            // Add execution context
            if (callStack.length > 1) {
                insightData.push({
                    title: "Execution Context",
                    description: "Call stack leading to this point",
                    iconPath: new vscode.ThemeIcon("call-incoming")
                });
                
                // Add stack frames (skip the current one)
                for (let i = 1; i < Math.min(callStack.length, 4); i++) {
                    insightData.push({
                        title: callStack[i],
                        description: `Stack frame ${i}`,
                        iconPath: new vscode.ThemeIcon("arrow-up")
                    });
                }
            }
            
            console.log(`Debug update ${updateId} refreshing view with ${insightData.length} items`);
            
            // Finally update the provider
            this.debugInsightsProvider.refresh(insightData);
        }, 500);
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
    
    /**
     * Find the most informative variables in the current context
     */
    private findMostInformativeVariables(variables: Record<string, any>): [string, any][] {
        const varEntries = Object.entries(variables);
        
        // Score variables by informativeness
        const scoredVars = varEntries.map(([name, value]) => {
            let score = 0;
            
            // User data variables are highly valuable
            if (name.includes('user') || name.includes('data') || name.includes('options')) score += 5;
            
            // Variables that often indicate state
            if (['i', 'j', 'index', 'key', 'count'].includes(name)) score += 3;
            if (['value', 'result', 'sum', 'total'].includes(name)) score += 4;
            if (['error', 'exception', 'status'].includes(name)) score += 5;
            
            // Complex objects may be more informative
            if (typeof value === 'object' && value !== null) score += 2;
            
            // Arrays with content
            if (Array.isArray(value) && value.length > 0) score += 3;
            
            return { name, value, score };
        });
        
        // Sort by score (highest first) and take top 5
        return scoredVars
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(({ name, value }) => [name, value]);
    }
    
    /**
     * Create a description of why a variable is important
     */
    private describeVariableImportance(name: string, value: any): string {
        if (['i', 'j', 'index', 'idx'].includes(name)) {
            return "Loop counter/index variable";
        }
        
        if (['sum', 'total', 'result', 'accumulated'].includes(name)) {
            return "Accumulator variable tracking computation progress";
        }
        
        if (['error', 'err', 'exception', 'ex'].includes(name)) {
            return "Error tracking variable";
        }
        
        if (name.includes('user')) {
            return "User data being processed";
        }
        
        if (name.includes('options') || name.includes('config')) {
            return "Configuration options affecting execution";
        }
        
        if (Array.isArray(value)) {
            return `Array with ${value.length} elements`;
        }
        
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            return `Object with ${keys.length} properties: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
        }
        
        return "Current value at breakpoint";
    }

    private async getVariables(session: vscode.DebugSession, scopes: any[], frameId: number): Promise<any> {
        const variables: any = {};
        
        try {
            for (const scope of scopes) {
                if (scope.name === 'Local' || scope.name === 'Locals' || 
                    scope.name === 'Global' || scope.name === 'Globals') {
                    
                    console.log(`Fetching variables from ${scope.name} scope (ref: ${scope.variablesReference})`);
                    
                    try {
                        const response = await session.customRequest('variables', { 
                            variablesReference: scope.variablesReference 
                        });
                        
                        console.log(`Got ${response.variables?.length || 0} variables from scope ${scope.name}`);
                        
                        if (response.variables) {
                            for (const variable of response.variables) {
                                variables[variable.name] = this.parseVariableValue(variable);
                            }
                        }
                    } catch (scopeError) {
                        console.error(`Error getting variables from scope ${scope.name}:`, scopeError);
                    }
                }
            }
            
            // If we didn't get any variables, try a direct evaluation approach
            if (Object.keys(variables).length === 0) {
                console.log("No variables found via scopes, trying eval...");
                try {
                    // Common variables to check in a simple test script
                    const commonVars = ['i', 'max', 'numbers', 'testArray'];
                    for (const varName of commonVars) {
                        try {
                            const evalResponse = await session.customRequest('evaluate', {
                                expression: varName,
                                frameId: frameId,
                                context: 'watch'
                            });
                            
                            if (evalResponse.result !== undefined) {
                                console.log(`Evaluated ${varName} = ${evalResponse.result}`);
                                variables[varName] = this.parseVariableValue({
                                    name: varName,
                                    value: evalResponse.result
                                });
                            }
                        } catch (evalError) {
                            console.log(`Could not evaluate ${varName}: ${evalError.message}`);
                        }
                    }
                } catch (evalError) {
                    console.error("Error with direct evaluation:", evalError);
                }
            }
        } catch (error) {
            console.error('Error getting variables:', error);
        }
        
        console.log("Final variables collected:", Object.keys(variables));
        return variables;
    }
    
    private parseVariableValue(variable: any): any {
        // Try to parse the variable value to get a usable form
        const value = variable.value;
        
        if (!value) return value;
        
        // Try to parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
            try {
                // This is simplified - would need more robust parsing for complex arrays
                return JSON.parse(value.replace(/'/g, '"'));
            } catch {
                // If parsing fails, fall back to string
            }
        }
        
        // Try to parse numbers
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            return parseFloat(value);
        }
        
        // Try to parse booleans
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        // Otherwise, just return the string value
        return value;
    }
    
    private findBreakpointAtLocation(fileName: string, lineNumber: number): IntelligentBreakpoint | undefined {
        const breakpoints = this.breakpointManager.getAllBreakpoints();
        
        const match = breakpoints.find(bp => 
            bp.uri.fsPath === fileName && 
            bp.line === lineNumber - 1 // Adjust for 0-based line numbers
        );
        
        if (match) {
            console.log(`Found matching breakpoint ${match.id} at ${fileName}:${lineNumber}`);
        } else {
            console.log(`No matching breakpoint found for ${fileName}:${lineNumber}`);
        }
        
        return match;
    }
    
    private showDebugInsight(
        breakpoint: IntelligentBreakpoint, 
        dataPoint: any, 
        prompt: { 
            text: string, 
            expectedValue: string,
            enhancedDetails?: any
        }
    ): void {
        // Find the variables to display - either from enhanced prompt or by extraction
        let relevantVars: string[] = [];
        
        if (prompt.enhancedDetails?.relevantVariables) {
            // Use LLM-identified relevant variables
            relevantVars = prompt.enhancedDetails.relevantVariables;
        } else {
            // Extract variable names from the prompt text
            relevantVars = this.extractVariableNames(prompt.text);
        }
        
        // Construct a message with the collected data
        const message = new vscode.MarkdownString();
        message.isTrusted = true;
        
        message.appendMarkdown(`## 📍 Debug Insight (${breakpoint.uri.fsPath.split('/').pop()}:${breakpoint.line + 1})\n\n`);
        message.appendMarkdown(`**${prompt.text}**\n\n`);
        
        // Add the values of mentioned variables
        if (relevantVars.length > 0) {
            message.appendMarkdown(`### Current Values:\n`);
            for (const varName of relevantVars) {
                const varValue = dataPoint.variables.find((v: any) => v.name === varName)?.value;
                if (varValue !== undefined) {
                    message.appendMarkdown(`\`${varName}\` = \`${varValue}\`\n\n`);
                }
            }
        }
        
        // Add expected behavior if specified
        if (prompt.expectedValue) {
            message.appendMarkdown(`### Expected Behavior:\n${prompt.expectedValue}\n\n`);
        }
        
        // Add check conditions if available from enhanced prompt
        if (prompt.enhancedDetails?.checkConditions && prompt.enhancedDetails.checkConditions.length > 0) {
            message.appendMarkdown(`### Checks to Perform:\n`);
            for (const check of prompt.enhancedDetails.checkConditions) {
                message.appendMarkdown(`- ${check}\n`);
            }
            message.appendMarkdown(`\n`);
        }
        
        // Add anomaly information if available
        if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1) {
            message.appendMarkdown(`⚠️ **Anomaly Detected:** Score ${dataPoint.anomalyScore.toFixed(2)}\n\n`);
            
            if (dataPoint.anomalyDetails?.explanation) {
                message.appendMarkdown(`*${dataPoint.anomalyDetails.explanation.explanation}*\n\n`);
            }
        }
        
        // Create a webview panel to show the insight
        const panel = vscode.window.createWebviewPanel(
            'debugInsight',
            'Debug Insight',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true
            }
        );
        
        panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Debug Insight</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                    }
                    h1 {
                        color: var(--vscode-editor-foreground);
                    }
                    .variable {
                        font-family: monospace;
                        background-color: var(--vscode-editor-background);
                        padding: 2px 5px;
                        border-radius: 3px;
                    }
                    .anomaly {
                        color: var(--vscode-errorForeground);
                        font-weight: bold;
                    }
                    .expected {
                        color: var(--vscode-editorInfo-foreground);
                    }
                </style>
            </head>
            <body>
                ${message.value}
            </body>
            </html>
        `;
    }
    
    private extractVariableNames(text: string): string[] {
        // Extract variable names from the prompt text
        // This is a simple implementation that looks for words
        // In a real system, this would be more sophisticated
        const words = text.split(/\s+/);
        const varNames: string[] = [];
        
        for (const word of words) {
            // Clean up the word (remove punctuation)
            const cleanWord = word.replace(/[^\w]/g, '');
            // Look for words that might be variables (camelCase, snake_case, etc.)
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanWord) && cleanWord.length > 1) {
                varNames.push(cleanWord);
            }
        }
        
        return varNames;
    }
    
    private suggestNextDebugSteps(
        breakpoint: IntelligentBreakpoint, 
        informativeVars: any[]
    ): void {
        // Suggest next debugging steps based on information gain
        const message = new vscode.MarkdownString();
        message.isTrusted = true;
        
        message.appendMarkdown(`## 🔍 Debug Suggestion\n\n`);
        
        message.appendMarkdown(`Based on AI analysis, focus on these variables at this breakpoint:\n\n`);
        
        for (const varInfo of informativeVars) {
            message.appendMarkdown(`- \`${varInfo.variableName}\` (Information gain: ${varInfo.informationGain.toFixed(2)})\n`);
        }
        
        message.appendMarkdown(`\nThese variables show the strongest correlation with observed anomalies.\n`);
        
        // Create a notification with buttons for quick actions
        vscode.window.showInformationMessage(
            `Debugging suggestion: Focus on variables ${informativeVars.map(v => v.variableName).join(', ')}`,
            'View Details',
            'Add Watch'
        ).then(selection => {
            if (selection === 'View Details') {
                // Show detailed information in a new panel
                const panel = vscode.window.createWebviewPanel(
                    'debugSuggestion',
                    'Debug Suggestion',
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true
                    }
                );
                
                panel.webview.html = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Debug Suggestion</title>
                        <style>
                            body {
                                font-family: var(--vscode-font-family);
                                padding: 20px;
                            }
                            h1 {
                                color: var(--vscode-editor-foreground);
                            }
                            .variable {
                                font-family: monospace;
                                background-color: var(--vscode-editor-background);
                                padding: 2px 5px;
                                border-radius: 3px;
                            }
                        </style>
                    </head>
                    <body>
                        ${message.value}
                    </body>
                    </html>
                `;
            } else if (selection === 'Add Watch') {
                // Add the suggested variables to the watch window
                for (const varInfo of informativeVars) {
                    vscode.debug.activeDebugSession?.customRequest('evaluate', {
                        expression: varInfo.variableName,
                        context: 'watch'
                    });
                }
            }
        });
    }
    
    private async analyzeDebugData(): Promise<void> {
        console.log("Starting debug data analysis...");
        // Run a comprehensive analysis after debugging ends
        try {
            // Get the top informative variables
            const topVars = this.infoGainAnalyzer.getTopInformativeVariables(5);
            console.log("Top informative variables:", topVars);
            
            // Get causal relationships
            const causalGraph = await this.causalAnalyzer.buildCausalGraph();
            console.log("Causal relationships found:", causalGraph.length);
            
            // Update the tree views with basic data even if no root causes are found
            if (this.breakpointsProvider) {
                const breakpoints = this.breakpointManager.getAllBreakpoints();
                this.breakpointsProvider.refresh(breakpoints.map(bp => ({
                    location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                    reason: bp.reason,
                    score: bp.score
                })));
            }
            
            // Always update the debug insights provider with variable data
            if (this.debugInsightsProvider) {
                const allSeries = this.dataCollector.getAllDataSeries();
                const insightData = [];
                
                // Create insights from collected data
                for (const series of allSeries) {
                    if (series.data.length > 0) {
                        // Get the latest data point
                        const latestPoint = series.data[series.data.length - 1];
                        
                        // Add variable value insights
                        for (const varValue of latestPoint.variables) {
                            insightData.push({
                                title: `${varValue.name} = ${varValue.value}`,
                                description: `at ${series.breakpointId.substr(0, 8)}`,
                            });
                        }
                        
                        // Add anomaly insights if any were detected
                        if (latestPoint.anomalyScore && latestPoint.anomalyScore > 1.0) {
                            insightData.push({
                                title: `Anomaly detected (score: ${latestPoint.anomalyScore.toFixed(2)})`,
                                description: latestPoint.anomalyDetails?.explanation?.explanation || 
                                    "Unusual behavior detected"
                            });
                        }
                    }
                }
                
                console.log("Updating debug insights with:", insightData.length, "items");
                
                if (insightData.length > 0) {
                    this.debugInsightsProvider.refresh(insightData);
                } else {
                    console.log("No debug insights data available, using default message");
                    this.debugInsightsProvider.refresh([{
                        title: "Debugger collected no variable data",
                        description: "Try setting breakpoints in key locations like loop boundaries"
                    }]);
                }
            }
            
            // Generate a summary of findings
            if (topVars.length > 0) {
                console.log("Looking for root causes...");
                // Get root causes with LLM insights
                const rootCauses = await this.causalAnalyzer.findRootCauses();
                console.log("Root causes found:", rootCauses.length);
                
                // Even if no root causes are found, at least update with default data
                if (this.rootCauseProvider) {
                    if (rootCauses.length > 0) {
                        console.log("Updating root cause provider with real data");
                        const firstCause = rootCauses[0];
                        this.rootCauseProvider.refresh(firstCause.llmInsight || {
                            description: firstCause.description,
                            explanation: "Based on causal analysis of execution data.",
                            confidence: firstCause.confidence,
                            relatedCode: [],
                            potentialFixes: firstCause.fixes
                        });
                    } else {
                        console.log("No runtime root causes found, checking static analysis");
                        
                        // Get static analysis issues from the breakpoint manager
                        const staticIssues = this.breakpointManager.getStaticAnalysisIssues();
                        console.log("Static analysis issues:", staticIssues?.potentialBugs?.length || 0);
                        
                        if (staticIssues && staticIssues.codeUnderstanding && 
                            staticIssues.codeUnderstanding.potentialBugs && 
                            staticIssues.codeUnderstanding.potentialBugs.length > 0) {
                            // Use the static analysis results instead
                            const mainIssue = staticIssues.codeUnderstanding.potentialBugs[0];
                            this.rootCauseProvider.refresh({
                                description: "Static analysis detected potential bug",
                                explanation: mainIssue,
                                confidence: 0.85, // Higher confidence for static analysis
                                relatedCode: [],
                                potentialFixes: staticIssues.suggestions || []
                            });
                            
                            // Also update fix suggestions
                            if (this.fixSuggestionsProvider && staticIssues.suggestions) {
                                // Create fix suggestions from the static analysis
                                this.fixSuggestionsProvider.refresh(staticIssues.suggestions.map(suggestion => ({
                                    description: suggestion,
                                    code: this.generateCodeFromSuggestion(suggestion),
                                    impact: "May fix the detected bug",
                                    confidence: 0.8
                                })));
                            }
                        } else {
                            // Fall back to default if no static issues either
                            this.rootCauseProvider.refresh({
                                description: "No definitive root cause identified",
                                explanation: `Key variables: ${topVars.map(v => v.variableName).join(', ')}`,
                                confidence: 0.5,
                                relatedCode: [],
                                potentialFixes: ["Watch key variables for unexpected changes"]
                            });
                        }
                    }
                }
                const staticIssues = this.breakpointManager.getStaticAnalysisIssues();
                console.log("Static analysis issues:", staticIssues);
                                  
                // Update fix suggestions even if we don't have root causes
                if (this.fixSuggestionsProvider) {
                    if (rootCauses.length > 0) {
                        console.log("Generating fix suggestions...");
                        const detailedFixes = await this.causalAnalyzer.generateFixSuggestions(rootCauses[0]);
                        console.log("Fix suggestions generated:", detailedFixes.length);
                        this.fixSuggestionsProvider.refresh(detailedFixes);
                    } else if (!staticIssues || !staticIssues.suggestions) {
                        console.log("Using default fix suggestions");
                        // Default suggestions based on top variables
                        this.fixSuggestionsProvider.refresh([{
                            description: "Check variable constraints",
                            code: `// Consider adding validation for these variables:\n` +
                                topVars.map(v => `// - ${v.variableName}`).join('\n'),
                            impact: "May prevent unexpected values",
                            confidence: 0.4
                        }]);
                    }
                }
                
                if (rootCauses.length > 0) {
                    await this.showRootCauseAnalysis(rootCauses);
                } else {
                    // Show simplified analysis if no root causes were found
                    this.showSimpleAnalysis(topVars, causalGraph);
                }
                
                // Show recent anomaly explanations
                const recentExplanations = this.dataCollector.getRecentAnomalyExplanations(3);
                if (recentExplanations.length > 0) {
                    this.showAnomalyExplanations(recentExplanations);
                }
            } else {
                console.log("No informative variables found, using fallback data");
                // If we didn't find informative variables, still update UI with fallback data
                if (this.debugInsightsProvider) {
                    this.debugInsightsProvider.refresh([{
                        title: "Debug session completed",
                        description: "No significant patterns detected"
                    }]);
                }
                
                if (this.rootCauseProvider) {
                    // Check static analysis for potential issues
                    const staticIssues = this.breakpointManager.getStaticAnalysisIssues();
                    console.log("Static analysis issues (fallback):", staticIssues?.codeUnderstanding?.potentialBugs?.length || 0);
                    
                    if (staticIssues && staticIssues.codeUnderstanding && 
                        staticIssues.codeUnderstanding.potentialBugs && 
                        staticIssues.codeUnderstanding.potentialBugs.length > 0) {
                        // Use the static analysis results 
                        const mainIssue = staticIssues.codeUnderstanding.potentialBugs[0];
                        this.rootCauseProvider.refresh({
                            description: "Static analysis detected potential bug",
                            explanation: mainIssue,
                            confidence: 0.85,
                            relatedCode: [],
                            potentialFixes: staticIssues.suggestions || []
                        });
                        
                        // Update fix suggestions too
                        if (this.fixSuggestionsProvider && staticIssues.suggestions) {
                            this.fixSuggestionsProvider.refresh(staticIssues.suggestions.map(suggestion => ({
                                description: suggestion,
                                code: this.generateCodeFromSuggestion(suggestion),
                                impact: "May fix the detected bug",
                                confidence: 0.8
                            })));
                        }
                    } else {
                        this.rootCauseProvider.refresh({
                            description: "No issues detected",
                            explanation: "The execution completed without notable anomalies",
                            confidence: 0.5,
                            relatedCode: [],
                            potentialFixes: []
                        });
                        
                        if (this.fixSuggestionsProvider) {
                            this.fixSuggestionsProvider.refresh([{
                                description: "No fixes needed",
                                code: "// Code appears to be functioning correctly",
                                impact: "N/A",
                                confidence: 0.5
                            }]);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error analyzing debug data:', error);
            // Even if analysis fails, update UI with error information
            if (this.debugInsightsProvider) {
                this.debugInsightsProvider.refresh([{
                    title: "Error analyzing debug data",
                    description: error.message
                }]);
            }
        }
    }
    
    // Add this helper method to create code examples from suggestions
    private generateCodeFromSuggestion(suggestion: string): string {
        // Extract key parts from the suggestion text
        if (suggestion.includes("i <= numbers.length") && suggestion.includes("i < numbers.length")) {
            return `// Fix the off-by-one error in the loop:
function findMax(numbers) {
    let max = numbers[0];
    
    // Change this line:
    for (let i = 0; i < numbers.length; i++) { // Was: i <= numbers.length
        if (numbers[i] > max) {
            max = numbers[i];
        }
    }
    
    return max;
}`;
        } else if (suggestion.includes("empty") || suggestion.includes("check")) {
            return `// Add input validation:
function findMax(numbers) {
    // Add validation
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
        throw new Error("Input must be a non-empty array");
    }
    
    let max = numbers[0];
    
    for (let i = 0; i < numbers.length; i++) {
        if (numbers[i] > max) {
            max = numbers[i];
        }
    }
    
    return max;
}`;
        } else {
            return `// Suggested fix based on analysis:
// ${suggestion}`;
        }
    }
    
    private async showRootCauseAnalysis(rootCauses: RootCause[]): Promise<void> {
        // Show a comprehensive root cause analysis with AI-generated insights
        const panel = vscode.window.createWebviewPanel(
            'rootCauseAnalysis',
            'AI Root Cause Analysis',
            vscode.ViewColumn.Active,
            {
                enableScripts: true
            }
        );
        
        // Generate HTML content
        let content = `
            <html>
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    h1 {
                        color: var(--vscode-editor-foreground);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 10px;
                    }
                    h2 {
                        color: var(--vscode-editorInfo-foreground);
                        margin-top: 20px;
                    }
                    .root-cause {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 5px;
                        padding: 15px;
                        margin-bottom: 20px;
                    }
                    .confidence {
                        display: inline-block;
                        padding: 3px 8px;
                        border-radius: 10px;
                        font-size: 0.8em;
                        margin-left: 10px;
                    }
                    .high {
                        background-color: #4caf5033;
                        color: #4caf50;
                    }
                    .medium {
                        background-color: #ff980033;
                        color: #ff9800;
                    }
                    .low {
                        background-color: #f4433633;
                        color: #f44336;
                    }
                    .code {
                        font-family: monospace;
                        background-color: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 5px;
                        overflow-x: auto;
                        margin: 10px 0;
                    }
                    .fix-suggestion {
                        border-left: 3px solid var(--vscode-editorInfo-foreground);
                        padding-left: 15px;
                        margin: 10px 0;
                    }
                </style>
            </head>
            <body>
                <h1>🔍 AI Root Cause Analysis</h1>
                <p>After analyzing your debugging session, the AI has identified the following potential root causes:</p>
        `;
        
        for (const cause of rootCauses) {
            // Determine confidence level class
            let confidenceClass = 'medium';
            if (cause.confidence > 0.7) confidenceClass = 'high';
            if (cause.confidence < 0.4) confidenceClass = 'low';
            
            content += `
                <div class="root-cause">
                    <h2>
                        ${cause.description}
                        <span class="confidence ${confidenceClass}">
                            ${Math.round(cause.confidence * 100)}% confidence
                        </span>
                    </h2>
            `;
            
            // Add LLM explanation if available
            if (cause.llmInsight) {
                content += `
                    <p>${cause.llmInsight.explanation}</p>
                    
                    <h3>Related Code Areas:</h3>
                    <ul>
                        ${cause.llmInsight.relatedCode.map(code => `<li>${code}</li>`).join('')}
                    </ul>
                `;
            }
            
            // Add fix suggestions
            content += `<h3>Suggested Fixes:</h3>`;
            
            // Generate detailed fix suggestions if available
            const detailedFixes = await this.causalAnalyzer.generateFixSuggestions(cause);
            
            for (const fix of detailedFixes) {
                content += `
                    <div class="fix-suggestion">
                        <h4>${fix.description}</h4>
                        <pre class="code">${this.escapeHtml(fix.code)}</pre>
                        <p><em>Impact: ${fix.impact}</em></p>
                    </div>
                `;
            }
            
            content += `</div>`;
        }
        
        content += `
                <p>These insights are based on analyzing execution patterns, anomalies, and code structure with machine learning and causal inference techniques.</p>
            </body>
            </html>
        `;
        
        panel.webview.html = content;
        
        // Also show a notification
        vscode.window.showInformationMessage(
            `AI Root Cause Analysis complete: ${rootCauses.length} potential root causes identified.`,
            'View Report'
        ).then(selection => {
            if (selection === 'View Report') {
                panel.reveal();
            }
        });
    }
    
    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    private showSimpleAnalysis(topVars: any[], causalGraph: any[]): void {
        // Show a simplified analysis when no advanced root causes were found
        let message = `## 📊 Debug Analysis Complete\n\n`;
        
        message += `Top variables with diagnostic value:\n`;
        for (const varInfo of topVars) {
            message += `- \`${varInfo.variableName}\` at breakpoint ${varInfo.breakpointId.substr(0, 8)} (Information gain: ${varInfo.informationGain.toFixed(2)})\n`;
        }
        
        message += `\nKey relationships detected:\n`;
        
        // Add causal relationships
        for (let i = 0; i < Math.min(causalGraph.length, 3); i++) {
            const relation = causalGraph[i];
            message += `- \`${relation.cause}\` affects \`${relation.effect}\` (strength: ${relation.strength.toFixed(2)})\n`;
        }
        
        // Show the message
        vscode.window.showInformationMessage(message, { modal: false });
    }
    
    private showAnomalyExplanations(explanations: any[]): void {
        // Show recent anomaly explanations
        let message = `## 🔍 Recent Anomaly Insights\n\n`;
        
        for (const item of explanations) {
            message += `### At breakpoint ${item.breakpointId.substr(0, 8)}:\n`;
            message += `${item.explanation.explanation}\n\n`;
            
            // Add most likely cause
            if (item.explanation.possibleCauses && item.explanation.possibleCauses.length > 0) {
                message += `Most likely cause: ${item.explanation.possibleCauses[0]}\n\n`;
            }
        }
                // Show the message
        vscode.window.showInformationMessage(message, { modal: false });
    }
    
    public async setBreakpoints(breakpoints: IntelligentBreakpoint[], documentUri: vscode.Uri): Promise<void> {
        // Set breakpoints in VS Code
        for (const bp of breakpoints) {
            await this.setVSCodeBreakpoint(bp);
        }
        
        // Update the breakpoints tree view
        if (this.breakpointsProvider) {
            this.breakpointsProvider.refresh(breakpoints.map(bp => ({
                location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                reason: bp.reason,
                score: bp.score
            })));
        }
    }
    /**
     * Sets a VS Code breakpoint with hover information but no visual decoration
     */
    private async setVSCodeBreakpoint(bp: IntelligentBreakpoint): Promise<void> {
        try {
            // Create a VS Code location object
            const location = new vscode.Location(
                bp.uri,
                new vscode.Position(bp.line, bp.column)
            );
            
            // Create a standard VS Code breakpoint
            const vscodeBreakpoint = new vscode.SourceBreakpoint(
                location,
                true, // enabled
                undefined, // no condition for now
                undefined, // no hit condition
                bp.id // id
            );
            
            // Store the breakpoint in our tracking map
            this.activeBreakpoints.set(bp.id, vscodeBreakpoint);
            
            // Check if VS Code already has this breakpoint to avoid duplicates
            const existingBreakpoints = vscode.debug.breakpoints.filter(existingBp => {
                if (existingBp instanceof vscode.SourceBreakpoint) {
                    return existingBp.location.uri.toString() === bp.uri.toString() && 
                        existingBp.location.range.start.line === bp.line;
                }
                return false;
            });
            
            // Only add if not already present
            if (existingBreakpoints.length === 0) {
                console.log(`Adding new breakpoint at ${bp.uri.fsPath}:${bp.line + 1}`);
                vscode.debug.addBreakpoints([vscodeBreakpoint]);
            } else {
                console.log(`Breakpoint at ${bp.uri.fsPath}:${bp.line + 1} already exists, enhancing with hover`);
            }
            
            // Generate a unique identifier for this breakpoint's hover provider
            const hoverProviderId = `hover-${bp.id}`;
            
            // Check if we already have a hover provider for this file
            const existingHoverProvider = this.disposables.find(d => 
                (d as any)._id === hoverProviderId
            );
            
            if (existingHoverProvider) {
                // Remove existing hover provider to avoid duplicates
                existingHoverProvider.dispose();
                this.disposables = this.disposables.filter(d => d !== existingHoverProvider);
            }
            
            // Register a hover provider to show information when hovering over this line
            const hoverDisposable = vscode.languages.registerHoverProvider({ 
                scheme: 'file', 
                pattern: bp.uri.fsPath 
            }, {
                provideHover: async (document, position, token) => {
                    // Only show hover info if hovering on the exact breakpoint line
                    if (position.line === bp.line) {
                        // Create rich markdown content for the hover
                        const markdown = new vscode.MarkdownString();
                        markdown.isTrusted = true;
                        
                        // Add a header with indicator that this is an intelligent breakpoint
                        markdown.appendMarkdown(`### $(debug-breakpoint) Intelligent Breakpoint\n\n`);
                        
                        // Show the reason this breakpoint was placed
                        if (bp.reason) {
                            markdown.appendMarkdown(`**Why:** ${bp.reason}\n\n`);
                        }
                        
                        // Generate explanations when hovered - this makes the hover powerful
                        try {
                            // Get surrounding code for context
                            const startLine = Math.max(0, bp.line - 2);
                            const endLine = Math.min(document.lineCount - 1, bp.line + 2);
                            let codeSnippet = '';
                            
                            for (let i = startLine; i <= endLine; i++) {
                                const lineText = document.lineAt(i).text;
                                if (i === bp.line) {
                                    codeSnippet += `> ${lineText}\n`; // Highlight the breakpoint line
                                } else {
                                    codeSnippet += `  ${lineText}\n`;
                                }
                            }
                            
                            // Use getAllDataSeries() and find the one for this breakpoint ID
                            const allSeries = this.dataCollector.getAllDataSeries();
                            const seriesForBreakpoint = allSeries.find(series => series.breakpointId === bp.id);
                            
                            // If we have real-time data for this breakpoint, offer insights
                            if (seriesForBreakpoint && seriesForBreakpoint.data && seriesForBreakpoint.data.length > 0) {
                                const latestPoint = seriesForBreakpoint.data[seriesForBreakpoint.data.length - 1];
                                
                                if (latestPoint.variables && latestPoint.variables.length > 0) {
                                    // Format variables
                                    const variables = latestPoint.variables.map(v => `${v.name}: ${v.value}`).join('\n');
                                    
                                    // Get AI insights about these variables
                                    try {
                                        const insight = await this.llmService.generateDebugInsight(
                                            document.fileName.split('/').pop() || document.fileName,
                                            bp.line + 1,
                                            codeSnippet,
                                            variables,
                                            latestPoint.callStack || []
                                        );
                                        
                                        // Add AI explanation
                                        markdown.appendMarkdown(`**Context:** ${insight.explanation}\n\n`);
                                        
                                        // Add key variables with explanations
                                        if (insight.keyVariables && insight.keyVariables.length > 0) {
                                            markdown.appendMarkdown(`**Key Variables:**\n`);
                                            for (const variable of insight.keyVariables) {
                                                markdown.appendMarkdown(`- \`${variable.name}\`: ${variable.explanation}\n`);
                                            }
                                            markdown.appendMarkdown(`\n`);
                                        }
                                        
                                        // Add potential issues
                                        if (insight.potentialIssues && insight.potentialIssues.length > 0) {
                                            markdown.appendMarkdown(`**Potential Issues:**\n`);
                                            for (const issue of insight.potentialIssues) {
                                                markdown.appendMarkdown(`- ${issue}\n`);
                                            }
                                            markdown.appendMarkdown(`\n`);
                                        }
                                    } catch (error) {
                                        console.error('Error getting insight for hover:', error);
                                        
                                        // Fall back to showing just the variables
                                        markdown.appendMarkdown(`**Current Variable Values:**\n`);
                                        for (const v of latestPoint.variables.slice(0, 5)) { // Limit to 5
                                            markdown.appendMarkdown(`- \`${v.name}\` = ${v.value}\n`);
                                        }
                                        markdown.appendMarkdown(`\n`);
                                    }
                                    
                                    // Show if there was an anomaly
                                    if (latestPoint.anomalyScore && latestPoint.anomalyScore > 1.0) {
                                        markdown.appendMarkdown(`⚠️ **Anomaly detected** (Score: ${latestPoint.anomalyScore.toFixed(2)})\n\n`);
                                    }
                                } else {
                                    markdown.appendMarkdown(`*No variables collected at this breakpoint yet.*\n\n`);
                                }
                            } else {
                                // Show key variables that should be watched (from static analysis)
                                if (bp.variables && bp.variables.length > 0) {
                                    markdown.appendMarkdown(`**Key Variables to Watch:**\n`);
                                    for (const variable of bp.variables) {
                                        markdown.appendMarkdown(`- \`${variable}\`\n`);
                                    }
                                    markdown.appendMarkdown(`\n`);
                                }
                            }
                            
                            // Show AI insights about this breakpoint if available
                            if (bp.llmInsights && bp.llmInsights.length > 0) {
                                markdown.appendMarkdown(`**AI Insights:**\n`);
                                for (const insight of bp.llmInsights) {
                                    markdown.appendMarkdown(`- ${insight}\n`);
                                }
                            }
                        } catch (error) {
                            console.error('Error generating hover content:', error);
                            markdown.appendMarkdown(`*Error generating insights: ${error.message}*\n\n`);
                        }
                        
                        // Add score information at the bottom
                        markdown.appendMarkdown(`\n---\n`);
                        markdown.appendMarkdown(`Priority Score: ${bp.score.toFixed(2)}\n`);
                        
                        return new vscode.Hover(markdown);
                    }
                    return null;
                }
            });
            
            // Store an ID on the disposable to identify it later
            (hoverDisposable as any)._id = hoverProviderId;
            
            // Add to disposables for cleanup
            this.disposables.push(hoverDisposable);
            
            // Optionally add a status bar notification
            const statusBarItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                100
            );
            
            statusBarItem.text = `$(debug-breakpoint) Intelligent breakpoint set at line ${bp.line + 1}`;
            statusBarItem.tooltip = bp.reason;
            statusBarItem.show();
            
            // Hide the status bar notification after 3 seconds
            setTimeout(() => {
                statusBarItem.hide();
                statusBarItem.dispose();
            }, 3000);
            
        } catch (error) {
            console.error(`Error setting breakpoint with hover at ${bp.uri.fsPath}:${bp.line + 1}:`, error);
        }
    }
/**
 * Cleanup method to dispose of all hover providers when needed
 * Call this when a debug session ends
 */
public clearBreakpointHovers(): void {
    // Find and dispose all hover providers
    const hoverProviders = this.disposables.filter(d => 
        (d as any)._id && (d as any)._id.startsWith('hover-')
    );
    
    for (const provider of hoverProviders) {
        provider.dispose();
    }
    
    // Remove them from our disposables list
    this.disposables = this.disposables.filter(d => 
        !((d as any)._id && (d as any)._id.startsWith('hover-'))
    );
}     
    // Helper method to get breakpoint icon
    private getBreakpointIconPath(): vscode.Uri {
        // You can create a custom icon in your extension resources folder
        // Or use a built-in codicon
        return vscode.Uri.parse('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI4IiBjeT0iOCIgcj0iOCIgZmlsbD0iI0YxNDg3QiIvPjwvc3ZnPg==');
    }

    /**
     * Update the LLM service with project context for current file
     * This ensures AI models have access to related files
     */
    public async provideProjectContext(filePath: string, llmService: LLMService): Promise<void> {
        if (!filePath) return;
        
        try {
            // Get project context for this file
            const relatedFiles = this.getProjectContext(filePath);
            
            // Format the context for the LLM
            if (relatedFiles.size > 0) {
                const context = new Map<string, string>();
                
                for (const [path, content] of relatedFiles.entries()) {
                    // Get a simplified version of the content for context
                    const simplifiedContent = this.getSimplifiedFileContent(content, path);
                    context.set(path.split('/').pop() || path, simplifiedContent);
                }
                
                // Update the LLM service with this context
                await llmService.setProjectContext(context);
                console.log(`Updated LLM with context from ${context.size} related files`);
            }
        } catch (error) {
            console.error('Error providing project context:', error);
        }
    }
    
    /**
     * Get a simplified version of file content (focusing on signatures and structure)
     */
    private getSimplifiedFileContent(content: string, filePath: string): string {
        // For large files, extract just the important parts
        if (content.length > 5000) {
            // Extract function/class definitions
            const lines = content.split('\n');
            const importLines: string[] = [];
            const signatureLines: string[] = [];
            
            // Extract imports and function/class signatures
            for (const line of lines) {
                if (line.includes('import ') || line.includes('require(')) {
                    importLines.push(line);
                } else if (
                    line.includes('function ') || 
                    line.includes('class ') ||
                    line.includes(' => {') ||
                    line.match(/\w+\s*\([^)]*\)\s*{/) // Function with parameters
                ) {
                    signatureLines.push(line);
                }
            }
            
            return `// Simplified content from ${filePath.split('/').pop()}\n` +
                importLines.join('\n') + '\n\n' +
                '// Function and class signatures:\n' +
                signatureLines.join('\n');
        }
        
        return content;
    }
    
    public dispose(): void {
        // Clean up resources
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}