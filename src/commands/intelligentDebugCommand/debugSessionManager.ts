import * as vscode from 'vscode';
import * as path from 'path';
import { BreakpointManager } from '../../breakpointManager';
import { DataCollector } from '../../dataCollector';
import { DebugInsightsProvider } from '../../treeDataProviders';
import { VariableAnalyzer } from './variableAnalyzer';

/**
 * Handles debug session management and breakpoint handling
 */
export class DebugSessionManager {
    constructor(
        private context: vscode.ExtensionContext,
        private breakpointManager: BreakpointManager,
        private dataCollector: DataCollector,
        private debugInsightsProvider: DebugInsightsProvider,
        private variableAnalyzer: VariableAnalyzer
    ) {}
    
    /**
     * Set up custom debug event handler for better UX
     */
    public setupCustomDebugEventHandler(): void {
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
     * Launch the debugger for the given file
     */
    public launchDebugger(filePath: string): void {
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
            
            // Enhanced variable collection with recursive exploration
            const variables: Record<string, any> = {};
            
            // Get scopes
            const scopesResponse = await session.customRequest('scopes', { frameId: topFrame.id });
            const scopes = scopesResponse.scopes || [];
            
            console.log(`Found ${scopes.length} scopes`);
            
            // Track all variableReferences to avoid circular references
            const visitedRefs = new Set<number>();
            
            // Collect variables from each scope
            for (const scope of scopes) {
                if (scope.variablesReference) {
                    await this.collectVariablesRecursively(
                        session, 
                        scope.variablesReference, 
                        variables,
                        0,  // Start at depth 0
                        3,  // Maximum depth to explore
                        "",  // No path for top-level variables
                        visitedRefs
                    );
                }
            }
            
            console.log(`Collected ${Object.keys(variables).length} variables with recursive traversal`);
            
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
            await this.updateDebugInsightsWithRuntimeData(
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
     * Recursively collect variables and their properties
     */
    private async collectVariablesRecursively(
        session: vscode.DebugSession,
        variablesReference: number,
        result: Record<string, any>,
        currentDepth: number,
        maxDepth: number,
        path: string,
        visitedRefs: Set<number>
    ): Promise<void> {
        // Avoid infinite recursion
        if (visitedRefs.has(variablesReference)) {
            console.log(`Circular reference detected at ${path}`);
            return;
        }
        
        // Track this reference
        visitedRefs.add(variablesReference);
        
        // Stop if we've reached max depth
        if (currentDepth >= maxDepth) {
            return;
        }
        
        try {
            // Get variables for this reference
            const response = await session.customRequest('variables', {
                variablesReference: variablesReference
            });
            
            if (!response.variables) return;
            
            // Process each variable
            for (const variable of response.variables) {
                // Skip internal or special variables
                if (variable.name.startsWith('__') || 
                    variable.name === 'this' ||
                    variable.name === 'arguments') {
                    continue;
                }
                
                // Determine the current variable path
                const currentPath = path ? `${path}.${variable.name}` : variable.name;
                
                // Add variable to the result object
                if (!path) {
                    // Top-level variables
                    result[variable.name] = this.variableAnalyzer.parseVariableValue(variable.value);
                } else {
                    // Set nested property value
                    this.setNestedProperty(result, currentPath, this.variableAnalyzer.parseVariableValue(variable.value));
                }
                
                // Recursively process child properties if they exist
                if (variable.variablesReference && 
                    variable.variablesReference !== variablesReference) {
                    
                    await this.collectVariablesRecursively(
                        session,
                        variable.variablesReference,
                        result,
                        currentDepth + 1,
                        maxDepth,
                        currentPath,
                        visitedRefs
                    );
                }
            }
        } catch (error) {
            console.error(`Error collecting variables at depth ${currentDepth}:`, error);
        }
    }

    /**
     * Set a property on an object using a path string like "user.profile.name"
     */
    private setNestedProperty(obj: any, path: string, value: any): void {
        // Split the path into parts
        const parts = path.split('.');
        
        // Navigate to the parent object
        let target = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            
            // Handle array indexing like "users[0]"
            const match = part.match(/^(.+)\[(\d+)\]$/);
            if (match) {
                const arrayName = match[1];
                const index = parseInt(match[2], 10);
                
                // Make sure the array exists
                if (!target[arrayName] || !Array.isArray(target[arrayName])) {
                    target[arrayName] = [];
                }
                
                // Make sure the index exists
                if (!target[arrayName][index]) {
                    target[arrayName][index] = {};
                }
                
                target = target[arrayName][index];
            } else {
                // Regular object property
                if (!target[part]) {
                    target[part] = {};
                }
                target = target[part];
            }
        }
        
        // Set the value on the target
        const lastPart = parts[parts.length - 1];
        
        // Handle array indexing in the final part
        const match = lastPart.match(/^(.+)\[(\d+)\]$/);
        if (match) {
            const arrayName = match[1];
            const index = parseInt(match[2], 10);
            
            // Make sure the array exists
            if (!target[arrayName]) {
                target[arrayName] = [];
            }
            
            // Set the value at the specified index
            target[arrayName][index] = value;
        } else {
            // Regular property assignment
            target[lastPart] = value;
        }
    }
    
    /**
     * Update the debug insights view with recursive variable analysis
     * and debugging questions
     */
    public async updateDebugInsightsWithRuntimeData(
        fileName: string,
        lineNumber: number,
        variables: Record<string, any>,
        callStack: string[],
        dataPoint: any,
        nodeId: string
    ): Promise<void> {
        if (!this.debugInsightsProvider) {
            console.warn('Debug insights provider is not available');
            return;
        }
        
        console.log(`Updating debug insights with runtime data for ${fileName}:${lineNumber}`);
        
        const insights = [];
        
        // Add breakpoint location info
        insights.push({
            title: `Breakpoint hit at ${path.basename(fileName)}:${lineNumber}`,
            description: callStack[0] || "Unknown function",
            iconPath: new vscode.ThemeIcon("debug-breakpoint"),
            nodeId
        });
        
        // Filter system variables
        const appVars = this.variableAnalyzer.extractApplicationVariables(variables);
        
        // -------------------------------------------------------------
        // STEP 3-4: Deep Variable Analysis & Information Gain
        // -------------------------------------------------------------
        
        // Perform recursive variable traversal
        const deepInsights = this.variableAnalyzer.recursivelyTraverseVariables(appVars);
        
        // Rank variables by informativeness and add insights section
        const rankedVars = this.variableAnalyzer.rankVariablesByDiagnosticUtility(appVars, null);
        
        // Add high-impact variables section
        insights.push({
            title: "🔍 High-Impact Variables",
            description: "Variables with highest diagnostic value at this point",
            iconPath: new vscode.ThemeIcon("symbol-variable"),
            nodeId
        });
        
        // Add top variables with context
        if (rankedVars.length > 0) {
            for (const [name, details] of rankedVars.slice(0, 5)) {
                const { value, score, reason } = details;
                
                insights.push({
                    title: `${name} (${this.variableAnalyzer.getShortTypeDescription(value)})`,
                    description: reason || this.variableAnalyzer.describeVariableImportance(name, value, appVars),
                    iconPath: new vscode.ThemeIcon("symbol-field"),
                    nodeId,
                    contextValue: 'variable',
                    value
                });
            }
        } else {
            insights.push({
                title: "No high-impact variables found",
                description: "Try setting breakpoints in your application code",
                iconPath: new vscode.ThemeIcon("warning"),
                nodeId
            });
        }
        
        // Group insights by categories for better organization
        const insightCategories = {
            "Error Conditions": [],
            "User Data": [],
            "State Values": [],
            "Configuration": [],
            "Other Insights": []
        };
        
        // Categorize the deep insights
        for (const insight of deepInsights) {
            if (insight.insights.includes("error") || insight.insights.includes("Error")) {
                insightCategories["Error Conditions"].push(insight);
            } else if (insight.path.includes("user") || insight.insights.includes("User")) {
                insightCategories["User Data"].push(insight);
            } else if (insight.insights.includes("status") || insight.insights.includes("state")) {
                insightCategories["State Values"].push(insight);
            } else if (insight.insights.includes("Configuration")) {
                insightCategories["Configuration"].push(insight);
            } else {
                insightCategories["Other Insights"].push(insight);
            }
        }
        
        // -------------------------------------------------------------
        // STEP 5: Nested Insights & Conversational Debug Prompts
        // -------------------------------------------------------------
        
        // Add deep insight categories
        let foundDeepInsights = false;
        let allNestedQuestions = [];
        
        for (const [category, categoryInsights] of Object.entries(insightCategories)) {
            if (categoryInsights.length > 0) {
                foundDeepInsights = true;
                insights.push({
                    title: `📊 ${category}`,
                    description: `${categoryInsights.length} insights found in nested properties`,
                    iconPath: new vscode.ThemeIcon("symbol-property"),
                    nodeId
                });
                
                // Add top 3 insights from this category
                for (const insight of categoryInsights.slice(0, 3)) {
                    insights.push({
                        title: `${insight.path}`,
                        description: insight.insights,
                        iconPath: new vscode.ThemeIcon("symbol-variable"),
                        nodeId,
                        contextValue: 'nestedInsight',
                        path: insight.path,
                        value: insight.value
                    });
                    
                    // Collect questions from this insight
                    if (insight.questions && insight.questions.length > 0) {
                        allNestedQuestions = allNestedQuestions.concat(
                            insight.questions.map(q => ({
                                question: q,
                                context: insight.path,
                                id: `question_${nodeId}_${insight.path}_${q.substring(0, 10)}`
                            }))
                        );
                    }
                }
            }
        }
        
        if (!foundDeepInsights) {
            insights.push({
                title: "No deep insights found",
                description: "No interesting nested properties detected in variables",
                iconPath: new vscode.ThemeIcon("info"),
                nodeId
            });
        }
        
        // -------------------------------------------------------------
        // STEP 5-B: Debugging Questions (Custom + Generated)
        // -------------------------------------------------------------
        
        // Combine custom prompts with questions from nested variable analysis
        const customPrompts = this.variableAnalyzer.getCustomPromptsForBreakpoint(nodeId, fileName, lineNumber);
        const allPrompts = [...customPrompts, ...allNestedQuestions];
        
        if (allPrompts.length > 0) {
            insights.push({
                title: "❓ Debugging Questions",
                description: "Questions to guide debugging at this point",
                iconPath: new vscode.ThemeIcon("question"),
                nodeId
            });
            
            for (const prompt of allPrompts.slice(0, 5)) { // Limit to top 5 questions
                insights.push({
                    title: prompt.question,
                    description: prompt.context || "Click to investigate this question",
                    iconPath: new vscode.ThemeIcon("comment-discussion"),
                    nodeId,
                    contextValue: 'debugPrompt',
                    promptId: prompt.id
                });
            }
        }
        
        // -------------------------------------------------------------
        // STEP 6-7: Execution Context & Root Cause Data
        // -------------------------------------------------------------
        
        // Add execution context
        if (callStack.length > 1) {
            insights.push({
                title: "📚 Execution Context",
                description: "Call stack leading to this point",
                iconPath: new vscode.ThemeIcon("call-incoming"),
                nodeId
            });
            
            for (let i = 0; i < Math.min(callStack.length, 3); i++) {
                insights.push({
                    title: callStack[i],
                    description: `Stack frame ${i}`,
                    iconPath: new vscode.ThemeIcon("debug-stackframe"),
                    nodeId
                });
            }
        }
        
        // Update the view
        console.log(`Refreshing debug insights with ${insights.length} items`);
        this.debugInsightsProvider.refresh(insights);
    }
}