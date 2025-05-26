import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BreakpointManager, IntelligentBreakpoint } from '../breakpointManager';
import { DataCollector } from '../dataCollector';
import { InformationGainAnalyzer } from '../informationGain';
import { CausalAnalysis } from '../causalAnalysis';
import { LLMService } from '../llmService';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from '../treeDataProviders';
import { CodeAnalyzer } from '../codeAnalyzer';
import { DebuggerAnalysis } from './debuggerAnalysis';
import { IntelligentDebugCommand } from '../commands/intelligentDebugCommand';

export class DebuggerIntegration implements vscode.Disposable {
    private breakpointManager: BreakpointManager;
    private dataCollector: DataCollector;
    private disposables: vscode.Disposable[] = [];
    private activeBreakpoints: Map<string, vscode.Breakpoint> = new Map();
    private infoGainAnalyzer: InformationGainAnalyzer;
    private causalAnalyzer: CausalAnalysis;
    private llmService: LLMService;
    private codeAnalyzer: CodeAnalyzer;
    private breakpointsProvider?: BreakpointsProvider;
    private rootCauseProvider?: RootCauseProvider;
    private fixSuggestionsProvider?: FixSuggestionsProvider;
    private debugInsightsProvider?: DebugInsightsProvider;
    private debuggerAnalysis: DebuggerAnalysis;
    private intelligentDebugCommand?: IntelligentDebugCommand;

    // Project-wide analysis support
    private projectFiles: Map<string, string> = new Map();
    private analyzedFiles: Set<string> = new Set();

    constructor(
        breakpointManager: BreakpointManager, 
        dataCollector: DataCollector,
        causalAnalyzer?: CausalAnalysis,
        infoGainAnalyzer?: InformationGainAnalyzer,
        llmService?: LLMService,
        intelligentDebugCommand?: IntelligentDebugCommand

    ) {
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.llmService = llmService || new LLMService();
        this.infoGainAnalyzer = infoGainAnalyzer || new InformationGainAnalyzer(dataCollector);
        this.causalAnalyzer = causalAnalyzer || new CausalAnalysis(dataCollector, this.llmService);
        this.codeAnalyzer = this.breakpointManager.getCodeAnalyzer();
        this.intelligentDebugCommand = intelligentDebugCommand;  // Store the reference

        
        // Initialize the analysis component with references to needed services
        this.debuggerAnalysis = new DebuggerAnalysis(
            this.breakpointManager,
            this.dataCollector,
            this.infoGainAnalyzer,
            this.causalAnalyzer,
            this.llmService,
        );
    }
    
    public setIntelligentDebugCommand(command: IntelligentDebugCommand): void {
        this.intelligentDebugCommand = command;
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
        
        // Pass providers to the analysis component
        this.debuggerAnalysis.setTreeProviders(
            breakpointsProvider,
            rootCauseProvider,
            fixSuggestionsProvider,
            debugInsightsProvider
        );
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
        
        // ✅ Register ALL possible event handlers for the debug session
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
        
        // Delegate the analysis to the specialized component
        await this.debuggerAnalysis.analyzeDebugData(
            this.breakpointsProvider,
            this.rootCauseProvider,
            this.fixSuggestionsProvider,
            this.debugInsightsProvider
        );
        
        console.log("Analysis complete, updating UI...");
        
        // Optional: Show a status bar notification that insights are available
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBar.text = "$(info) Debug insights available";
        statusBar.tooltip = "Click to view debug insights";
        statusBar.command = 'intelligent-debugger.viewInsights'; // This command should be registered elsewhere to show the panel
        statusBar.show();
        
        // Hide the notification after 10 seconds
        setTimeout(() => statusBar.dispose(), 30000);
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
        
        // FIXED: Now we use the intelligentDebugCommand with LLM integration
        if (this.intelligentDebugCommand) {
            console.log("Using intelligentDebugCommand.updateDebugInsightsWithRuntimeData with LLM integration...");
            try {
                await this.intelligentDebugCommand.updateDebugInsightsWithRuntimeData(
                    fileName,
                    lineNumber,
                    variables,
                    callStack,
                    dataPoint,
                    nodeId
                );
            } catch (error) {
                console.error("Error updating debug insights:", error);
            }
        } else {
            console.warn("⚠️ intelligentDebugCommand not available, debug insights will be limited");
            // Fallback to basic display
            if (this.debugInsightsProvider) {
                this.debugInsightsProvider.refresh([
                    {
                        title: `Breakpoint hit at ${path.basename(fileName)}:${lineNumber}`,
                        description: callStack[0] || "Unknown function"
                    },
                    {
                        title: "Variables",
                        description: `${Object.keys(variables).length} variables collected`
                    }
                ]);
            }
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
    
    // Helper method for getting variables through evaluation
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
    
    /**
 * Get variables with direct inspection of all scopes and values
 */
private async getVariables(session: vscode.DebugSession, scopes: any[], frameId: number): Promise<any> {
    const variables: any = {};
    
    try {
        console.log(`Collecting variables from ${scopes.length} scopes`);
        
        // Log all scopes to help diagnose the issue
        for (const scope of scopes) {
            console.log(`Available scope: ${scope.name}, ref: ${scope.variablesReference}`);
        }
        
        // SPECIAL DEBUG FOR YOUR CASE: Check locals first
        const localScope = scopes.find(s => s.name === 'Local' || s.name === 'Locals');
        if (localScope) {
            console.log(`DIRECT: Examining local scope ${localScope.name}`);
            try {
                const response = await session.customRequest('variables', { 
                    variablesReference: localScope.variablesReference 
                });
                
                if (response.variables && response.variables.length > 0) {
                    console.log(`DIRECT: Found ${response.variables.length} local variables:`, 
                        response.variables.map(v => v.name).join(', '));
                    
                    // Extract local variables
                    for (const variable of response.variables) {
                        // Store the name and value directly
                        variables[variable.name] = variable.value;
                        
                        // Log what we found
                        console.log(`DIRECT: Found local variable ${variable.name} = ${variable.value}`);
                        
                        // If it's a complex object with nested values, try to extract them too
                        if (variable.variablesReference && variable.variablesReference > 0) {
                            try {
                                const nestedVars = await session.customRequest('variables', {
                                    variablesReference: variable.variablesReference
                                });
                                
                                // Create an object to hold nested properties
                                const objProps = {};
                                
                                // Log nested properties for debugging
                                console.log(`DIRECT: ${variable.name} has ${nestedVars.variables?.length || 0} properties`);
                                
                                // Add each nested property
                                if (nestedVars.variables && nestedVars.variables.length > 0) {
                                    for (const prop of nestedVars.variables) {
                                        objProps[prop.name] = prop.value;
                                        console.log(`DIRECT: ${variable.name}.${prop.name} = ${prop.value}`);
                                    }
                                }
                                
                                // Replace string value with actual object
                                if (Object.keys(objProps).length > 0) {
                                    variables[variable.name] = objProps;
                                }
                            } catch (err) {
                                console.log(`DIRECT: Error getting properties for ${variable.name}:`, err);
                            }
                        }
                    }
                } else {
                    console.log("DIRECT: No variables found in local scope!");
                }
            } catch (err) {
                console.error("DIRECT: Error accessing local scope:", err);
            }
        }
        
        // IMPORTANT: Check for special scopes with user-defined variables
        const blockScope = scopes.find(s => s.name === 'Block' || s.name === 'Closure');
        if (blockScope) {
            console.log(`DIRECT: Examining block/closure scope ${blockScope.name}`);
            try {
                const response = await session.customRequest('variables', { 
                    variablesReference: blockScope.variablesReference 
                });
                
                if (response.variables && response.variables.length > 0) {
                    console.log(`DIRECT: Found ${response.variables.length} block scope variables:`, 
                        response.variables.map(v => v.name).join(', '));
                    
                    // Extract block scope variables (only if not already found in local scope)
                    for (const variable of response.variables) {
                        if (!variables[variable.name]) {
                            variables[variable.name] = variable.value;
                            console.log(`DIRECT: Found block variable ${variable.name} = ${variable.value}`);
                        }
                    }
                }
            } catch (err) {
                console.error("DIRECT: Error accessing block/closure scope:", err);
            }
        }
        
        // Try direct evaluation as a last resort
        const commonVariableNames = [
            'user', 'userData', 'data', 'validation', 'result', 'response', 'request',
            'error', 'options', 'config', 'input', 'output', 'item', 'items'
        ];
        
        console.log("DIRECT: Trying direct evaluation of common variables");
        
        for (const varName of commonVariableNames) {
            if (!variables[varName]) { // Only if we don't already have it
                try {
                    const evalResponse = await session.customRequest('evaluate', {
                        expression: varName,
                        frameId: frameId,
                        context: 'watch'
                    });
                    
                    if (evalResponse.result !== undefined && 
                        evalResponse.result !== 'undefined' && 
                        evalResponse.result !== 'null') {
                        
                        variables[varName] = evalResponse.result;
                        console.log(`DIRECT: Evaluated ${varName} = ${evalResponse.result}`);
                        
                        // If it's a complex result, try to parse it
                        if (evalResponse.variablesReference && evalResponse.variablesReference > 0) {
                            try {
                                const nestedVars = await session.customRequest('variables', {
                                    variablesReference: evalResponse.variablesReference
                                });
                                
                                // Create an object to hold nested properties
                                const objProps = {};
                                
                                // Add each nested property
                                if (nestedVars.variables && nestedVars.variables.length > 0) {
                                    for (const prop of nestedVars.variables) {
                                        objProps[prop.name] = prop.value;
                                    }
                                }
                                
                                // Replace string value with actual object if we got properties
                                if (Object.keys(objProps).length > 0) {
                                    variables[varName] = objProps;
                                }
                            } catch (err) {
                                console.log(`DIRECT: Error getting properties for ${varName}:`, err);
                            }
                        }
                    }
                } catch (err) {
                    // Silently ignore evaluation errors - variable might not exist
                }
            }
        }
        
    } catch (error) {
        console.error('Error collecting variables:', error);
    }
    
    console.log(`DIRECT: Final variable collection has ${Object.keys(variables).length} variables`);
    console.log('DIRECT: Variable names:', Object.keys(variables).join(', '));
    
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
    
    public async setBreakpoints(breakpoints: IntelligentBreakpoint[], documentUri: vscode.Uri): Promise<void> {
        // First clear all existing breakpoints to avoid mixed types
        this.clearAllBreakpoints();
        
        // Set breakpoints in VS Code
        for (const bp of breakpoints) {
            await this.setVSCodeBreakpoint(bp);
        }
        
        // Update the breakpoints tree view
        if (this.breakpointsProvider) {
            this.breakpointsProvider.refresh(breakpoints.map(bp => ({
                location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                reason: bp.reason || 'Intelligent analysis',
                score: bp.score
            })));
        }
    }

    /**
 * Clear all existing breakpoints in VS Code
    */
    private clearAllBreakpoints(): void {
        // Get all existing breakpoints
        const existingBreakpoints = vscode.debug.breakpoints;
        
        // Remove all of them
        if (existingBreakpoints.length > 0) {
            console.log(`Clearing ${existingBreakpoints.length} existing breakpoints`);
            vscode.debug.removeBreakpoints(existingBreakpoints);
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
        
        // Create a standard VS Code breakpoint - NO logMessage parameter
        const vscodeBreakpoint = new vscode.SourceBreakpoint(
            location,
            true, // enabled
            undefined, // no condition
            undefined // no hit condition
            // NO logMessage parameter here
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
        
        // Remove any existing breakpoints at this location, especially logpoints
        if (existingBreakpoints.length > 0) {
            vscode.debug.removeBreakpoints(existingBreakpoints);
        }
        
        // Add our standard breakpoint
        console.log(`Adding new breakpoint at ${bp.uri.fsPath}:${bp.line + 1}`);
        vscode.debug.addBreakpoints([vscodeBreakpoint]);
        
        // ⚠️ Rest of the method unchanged...
        // (Register hover providers, etc.)
    }
    catch (error) {
        console.error(`Error setting breakpoint at ${bp.uri.fsPath}:${bp.line + 1}:`, error);
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