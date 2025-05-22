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
exports.DebuggerIntegration = void 0;
const vscode = __importStar(require("vscode"));
const conversationalPrompts_1 = require("./conversationalPrompts");
const informationGain_1 = require("./informationGain");
const causalAnalysis_1 = require("./causalAnalysis");
const llmService_1 = require("./llmService");
class DebuggerIntegration {
    constructor(breakpointManager, dataCollector, causalAnalyzer, infoGainAnalyzer, llmService) {
        this.disposables = [];
        this.activeBreakpoints = new Map();
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.llmService = llmService || new llmService_1.LLMService();
        this.promptManager = new conversationalPrompts_1.ConversationalPrompts(undefined, this.llmService);
        this.infoGainAnalyzer = infoGainAnalyzer || new informationGain_1.InformationGainAnalyzer(dataCollector);
        this.causalAnalyzer = causalAnalyzer || new causalAnalysis_1.CausalAnalysis(dataCollector, this.llmService);
    }
    setTreeProviders(breakpointsProvider, rootCauseProvider, fixSuggestionsProvider, debugInsightsProvider) {
        this.breakpointsProvider = breakpointsProvider;
        this.rootCauseProvider = rootCauseProvider;
        this.fixSuggestionsProvider = fixSuggestionsProvider;
        this.debugInsightsProvider = debugInsightsProvider;
    }
    registerEventHandlers() {
        // Register debug session event handlers
        this.disposables.push(vscode.debug.onDidStartDebugSession(this.handleDebugSessionStart.bind(this)), vscode.debug.onDidTerminateDebugSession(this.handleDebugSessionEnd.bind(this)), vscode.debug.onDidChangeBreakpoints(this.handleBreakpointsChange.bind(this)));
    }
    async handleDebugSessionStart(session) {
        console.log("Debug session started:", session.type, session.id, session.name);
        // Clear previous data when starting a new debug session
        this.dataCollector.clearData();
        // Log existing breakpoints
        const breakpoints = this.breakpointManager.getAllBreakpoints();
        console.log(`Setting ${breakpoints.length} intelligent breakpoints`);
        for (const bp of breakpoints) {
            console.log(`Breakpoint: ${bp.uri.fsPath}:${bp.line + 1} (ID: ${bp.id})`);
            await this.setVSCodeBreakpoint(bp);
        }
        // *** ENHANCED DEBUG ADAPTER TRACKING ***
        // Register debug adapter tracker with MORE MESSAGE LOGGING
        this.disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (trackerSession) => {
                console.log(`Creating tracker for debug session: ${trackerSession.id}`);
                return {
                    onWillStartSession: () => {
                        console.log(`Debug tracker: session starting`);
                    },
                    onWillReceiveMessage: (message) => {
                        console.log(`Debug tracker: receiving message type=${message.type || 'unknown'}`);
                    },
                    onDidSendMessage: async (message) => {
                        var _a, _b, _c;
                        // Log all messages to see what's coming through
                        console.log(`Debug message sent: type=${message.type}, event=${message.event || 'none'}`, message.body ? `body keys: ${Object.keys(message.body).join(', ')}` : 'no body');
                        // Look for stopped events and breakpoint events
                        if (message.type === 'event') {
                            if (message.event === 'stopped') {
                                console.log(`STOPPED EVENT: reason=${(_a = message.body) === null || _a === void 0 ? void 0 : _a.reason}, threadId=${(_b = message.body) === null || _b === void 0 ? void 0 : _b.threadId}`);
                                await this.handleBreakpointHit(trackerSession, message);
                            }
                            else if (message.event === 'breakpoint') {
                                console.log(`BREAKPOINT EVENT: ${JSON.stringify(message.body || {})}`);
                            }
                            else if (message.event === 'initialized') {
                                console.log(`INITIALIZED EVENT: debugger ready`);
                            }
                        }
                        // Also catch any "output" events 
                        if (message.type === 'event' && message.event === 'output') {
                            console.log(`DEBUG OUTPUT: ${((_c = message.body) === null || _c === void 0 ? void 0 : _c.output) || ''}`);
                        }
                    },
                    onError: (error) => {
                        console.error(`Debug tracker error: ${error.message}`, error);
                    },
                    onExit: (code, signal) => {
                        console.log(`Debug tracker: session exited with code ${code}, signal ${signal}`);
                    },
                    onWillStopSession: () => {
                        console.log(`Debug tracker: session stopping`);
                    }
                };
            }
        }));
        // Also register for the STANDARD events from VSCode
        this.disposables.push(vscode.debug.onDidChangeBreakpoints(event => {
            console.log(`Breakpoints changed: ${event.added.length} added, ${event.removed.length} removed, ${event.changed.length} changed`);
        }), vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
            console.log(`Custom debug event: ${event.event}`, event.body);
        }), vscode.debug.onDidStartDebugSession(debugSession => {
            if (debugSession.id !== session.id) {
                console.log(`Another debug session started: ${debugSession.id}`);
            }
        }));
        // Notify user
        vscode.window.showInformationMessage('Intelligent Debugger active: AI-assisted debugging enabled.', 'Learn More').then(selection => {
            if (selection === 'Learn More') {
                vscode.commands.executeCommand('intelligent-debugger.viewInsights');
            }
        });
    }
    async handleDebugSessionEnd(session) {
        console.log("Debug session ended, analyzing data...");
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
        // Manually trigger panel update
        vscode.commands.executeCommand('intelligent-debugger.viewInsights');
    }
    async handleBreakpointsChange(event) {
        // Handle manually added/removed breakpoints
        // We could integrate user-added breakpoints into our analysis
    }
    async handleBreakpointHit(session, message) {
        var _a, _b, _c, _d, _e;
        console.log("Breakpoint hit detected:", (_a = message.body) === null || _a === void 0 ? void 0 : _a.threadId);
        // A breakpoint was hit - let's collect data
        try {
            // Get the current stack frame
            const threadId = message.body.threadId;
            console.log("Thread ID:", threadId);
            const stackFrames = await this.getStackFrames(session, threadId);
            console.log("Stack frames count:", stackFrames.length);
            if (stackFrames.length === 0) {
                console.log("No stack frames available, skipping data collection");
                return;
            }
            const topFrame = stackFrames[0];
            const fileName = ((_b = topFrame.source) === null || _b === void 0 ? void 0 : _b.path) || '';
            const lineNumber = topFrame.line;
            console.log(`Hit at ${fileName}:${lineNumber}`);
            // Find our intelligent breakpoint at this location
            const matchingBp = this.findBreakpointAtLocation(fileName, lineNumber);
            console.log("Matching breakpoint:", matchingBp ? matchingBp.id : "None");
            if (matchingBp) {
                // Get variables in the current scope
                const scopes = await this.getScopes(session, topFrame.id);
                console.log("Scopes found:", scopes.length);
                const variables = await this.getVariables(session, scopes, topFrame.id);
                console.log("Variables collected:", Object.keys(variables));
                // Convert stack frames to strings for the call stack
                const callStack = stackFrames.map(frame => { var _a; return `${frame.name} (${(_a = frame.source) === null || _a === void 0 ? void 0 : _a.name}:${frame.line})`; });
                // Collect the data
                const dataPoint = await this.dataCollector.collectData(matchingBp.id, matchingBp.nodeId, variables, callStack);
                console.log("Data point collected:", dataPoint ? "success" : "failed");
                // Update the debug insights view in real-time
                if (this.debugInsightsProvider) {
                    const insightData = [];
                    // Add basic execution context
                    insightData.push({
                        title: `Breakpoint hit at ${fileName.split('/').pop()}:${lineNumber}`,
                        description: `Call stack: ${callStack[0] || 'Main'}`
                    });
                    // Add variable values
                    for (const [name, value] of Object.entries(variables)) {
                        insightData.push({
                            title: `${name} = ${value}`,
                            description: "Current variable value"
                        });
                    }
                    // Add anomaly info if available
                    if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.0) {
                        insightData.push({
                            title: `Anomaly detected (score: ${dataPoint.anomalyScore.toFixed(2)})`,
                            description: ((_d = (_c = dataPoint.anomalyDetails) === null || _c === void 0 ? void 0 : _c.explanation) === null || _d === void 0 ? void 0 : _d.explanation) ||
                                "Unusual behavior detected"
                        });
                    }
                    console.log("Updating debug insights with", insightData.length, "items");
                    this.debugInsightsProvider.refresh(insightData);
                }
                // Check if we have a custom prompt for this breakpoint
                const prompt = await this.promptManager.getPrompt(vscode.Uri.file(fileName), lineNumber - 1);
                if (prompt) {
                    // Display the custom prompt with collected data and enhanced insights
                    this.showDebugInsight(matchingBp, dataPoint, prompt);
                }
                // Run real-time analysis
                const infoGain = this.infoGainAnalyzer.getInformativeVariablesForBreakpoint(matchingBp.id);
                // If we detected anomalies, suggest focus areas
                if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.5) {
                    // Show anomaly explanation from LLM if available
                    if ((_e = dataPoint.anomalyDetails) === null || _e === void 0 ? void 0 : _e.explanation) {
                        this.showAnomalyExplanation(matchingBp, dataPoint);
                    }
                    this.suggestNextDebugSteps(matchingBp, infoGain);
                }
                // If this breakpoint has LLM insights, show them
                if (matchingBp.llmInsights && matchingBp.llmInsights.length > 0) {
                    this.showLLMInsights(matchingBp);
                }
            }
            else {
                console.log("No matching intelligent breakpoint found at", fileName, lineNumber);
            }
        }
        catch (error) {
            console.error('Error handling breakpoint hit:', error);
        }
    }
    showAnomalyExplanation(breakpoint, dataPoint) {
        var _a;
        if (!((_a = dataPoint.anomalyDetails) === null || _a === void 0 ? void 0 : _a.explanation))
            return;
        const explanation = dataPoint.anomalyDetails.explanation;
        const message = new vscode.MarkdownString();
        message.isTrusted = true;
        message.appendMarkdown(`## 🔍 AI Anomaly Explanation\n\n`);
        message.appendMarkdown(`**${explanation.explanation}**\n\n`);
        message.appendMarkdown(`### Possible Causes:\n`);
        for (const cause of explanation.possibleCauses) {
            message.appendMarkdown(`- ${cause}\n`);
        }
        message.appendMarkdown(`\n### Suggested Checks:\n`);
        for (const check of explanation.suggestedChecks) {
            message.appendMarkdown(`- ${check}\n`);
        }
        message.appendMarkdown(`\n*Confidence: ${(explanation.confidence * 100).toFixed(0)}%*`);
        // Create a new hover to show the explanation
        const uri = breakpoint.uri;
        const position = new vscode.Position(breakpoint.line, 0);
        const range = new vscode.Range(position, position);
        // Show diagnostic with the explanation
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('intelligentDebugger');
        const diagnostic = new vscode.Diagnostic(range, `AI detected anomaly: ${explanation.explanation.substring(0, 100)}...`, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'AI Debugger';
        diagnosticCollection.set(uri, [diagnostic]);
        // Also show a notification
        vscode.window.showWarningMessage(`AI detected anomaly at ${breakpoint.uri.fsPath}:${breakpoint.line + 1}. See Problems panel for details.`, 'View Details').then(selection => {
            if (selection === 'View Details') {
                vscode.commands.executeCommand('workbench.action.problems.focus');
            }
        });
    }
    showLLMInsights(breakpoint) {
        if (!breakpoint.llmInsights || breakpoint.llmInsights.length === 0)
            return;
        const message = `🧠 **AI Debug Insights** for breakpoint at ${breakpoint.uri.fsPath}:${breakpoint.line + 1}:\n\n` +
            breakpoint.llmInsights.map(insight => `- ${insight}`).join('\n');
        vscode.window.showInformationMessage(message);
    }
    async getStackFrames(session, threadId) {
        try {
            const response = await session.customRequest('stackTrace', { threadId });
            return response.stackFrames || [];
        }
        catch (error) {
            console.error('Error getting stack frames:', error);
            return [];
        }
    }
    async getScopes(session, frameId) {
        try {
            const response = await session.customRequest('scopes', { frameId });
            return response.scopes || [];
        }
        catch (error) {
            console.error('Error getting scopes:', error);
            return [];
        }
    }
    async getVariables(session, scopes, frameId) {
        var _a;
        const variables = {};
        try {
            for (const scope of scopes) {
                if (scope.name === 'Local' || scope.name === 'Locals' ||
                    scope.name === 'Global' || scope.name === 'Globals') {
                    console.log(`Fetching variables from ${scope.name} scope (ref: ${scope.variablesReference})`);
                    try {
                        const response = await session.customRequest('variables', {
                            variablesReference: scope.variablesReference
                        });
                        console.log(`Got ${((_a = response.variables) === null || _a === void 0 ? void 0 : _a.length) || 0} variables from scope ${scope.name}`);
                        if (response.variables) {
                            for (const variable of response.variables) {
                                variables[variable.name] = this.parseVariableValue(variable);
                            }
                        }
                    }
                    catch (scopeError) {
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
                        }
                        catch (evalError) {
                            console.log(`Could not evaluate ${varName}: ${evalError.message}`);
                        }
                    }
                }
                catch (evalError) {
                    console.error("Error with direct evaluation:", evalError);
                }
            }
        }
        catch (error) {
            console.error('Error getting variables:', error);
        }
        console.log("Final variables collected:", Object.keys(variables));
        return variables;
    }
    parseVariableValue(variable) {
        // Try to parse the variable value to get a usable form
        const value = variable.value;
        if (!value)
            return value;
        // Try to parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
            try {
                // This is simplified - would need more robust parsing for complex arrays
                return JSON.parse(value.replace(/'/g, '"'));
            }
            catch (_a) {
                // If parsing fails, fall back to string
            }
        }
        // Try to parse numbers
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            return parseFloat(value);
        }
        // Try to parse booleans
        if (value === 'true')
            return true;
        if (value === 'false')
            return false;
        // Otherwise, just return the string value
        return value;
    }
    findBreakpointAtLocation(fileName, lineNumber) {
        const breakpoints = this.breakpointManager.getAllBreakpoints();
        const match = breakpoints.find(bp => bp.uri.fsPath === fileName &&
            bp.line === lineNumber - 1 // Adjust for 0-based line numbers
        );
        if (match) {
            console.log(`Found matching breakpoint ${match.id} at ${fileName}:${lineNumber}`);
        }
        else {
            console.log(`No matching breakpoint found for ${fileName}:${lineNumber}`);
        }
        return match;
    }
    showDebugInsight(breakpoint, dataPoint, prompt) {
        var _a, _b, _c, _d;
        // Find the variables to display - either from enhanced prompt or by extraction
        let relevantVars = [];
        if ((_a = prompt.enhancedDetails) === null || _a === void 0 ? void 0 : _a.relevantVariables) {
            // Use LLM-identified relevant variables
            relevantVars = prompt.enhancedDetails.relevantVariables;
        }
        else {
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
                const varValue = (_b = dataPoint.variables.find((v) => v.name === varName)) === null || _b === void 0 ? void 0 : _b.value;
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
        if (((_c = prompt.enhancedDetails) === null || _c === void 0 ? void 0 : _c.checkConditions) && prompt.enhancedDetails.checkConditions.length > 0) {
            message.appendMarkdown(`### Checks to Perform:\n`);
            for (const check of prompt.enhancedDetails.checkConditions) {
                message.appendMarkdown(`- ${check}\n`);
            }
            message.appendMarkdown(`\n`);
        }
        // Add anomaly information if available
        if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1) {
            message.appendMarkdown(`⚠️ **Anomaly Detected:** Score ${dataPoint.anomalyScore.toFixed(2)}\n\n`);
            if ((_d = dataPoint.anomalyDetails) === null || _d === void 0 ? void 0 : _d.explanation) {
                message.appendMarkdown(`*${dataPoint.anomalyDetails.explanation.explanation}*\n\n`);
            }
        }
        // Create a webview panel to show the insight
        const panel = vscode.window.createWebviewPanel('debugInsight', 'Debug Insight', vscode.ViewColumn.Beside, {
            enableScripts: true
        });
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
    extractVariableNames(text) {
        // Extract variable names from the prompt text
        // This is a simple implementation that looks for words
        // In a real system, this would be more sophisticated
        const words = text.split(/\s+/);
        const varNames = [];
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
    suggestNextDebugSteps(breakpoint, informativeVars) {
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
        vscode.window.showInformationMessage(`Debugging suggestion: Focus on variables ${informativeVars.map(v => v.variableName).join(', ')}`, 'View Details', 'Add Watch').then(selection => {
            var _a;
            if (selection === 'View Details') {
                // Show detailed information in a new panel
                const panel = vscode.window.createWebviewPanel('debugSuggestion', 'Debug Suggestion', vscode.ViewColumn.Beside, {
                    enableScripts: true
                });
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
            }
            else if (selection === 'Add Watch') {
                // Add the suggested variables to the watch window
                for (const varInfo of informativeVars) {
                    (_a = vscode.debug.activeDebugSession) === null || _a === void 0 ? void 0 : _a.customRequest('evaluate', {
                        expression: varInfo.variableName,
                        context: 'watch'
                    });
                }
            }
        });
    }
    async analyzeDebugData() {
        var _a, _b, _c, _d, _e;
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
                                description: ((_b = (_a = latestPoint.anomalyDetails) === null || _a === void 0 ? void 0 : _a.explanation) === null || _b === void 0 ? void 0 : _b.explanation) ||
                                    "Unusual behavior detected"
                            });
                        }
                    }
                }
                console.log("Updating debug insights with:", insightData.length, "items");
                if (insightData.length > 0) {
                    this.debugInsightsProvider.refresh(insightData);
                }
                else {
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
                    }
                    else {
                        console.log("No runtime root causes found, checking static analysis");
                        // Get static analysis issues from the breakpoint manager
                        const staticIssues = this.breakpointManager.getStaticAnalysisIssues();
                        console.log("Static analysis issues:", ((_c = staticIssues === null || staticIssues === void 0 ? void 0 : staticIssues.potentialBugs) === null || _c === void 0 ? void 0 : _c.length) || 0);
                        if (staticIssues && staticIssues.codeUnderstanding &&
                            staticIssues.codeUnderstanding.potentialBugs &&
                            staticIssues.codeUnderstanding.potentialBugs.length > 0) {
                            // Use the static analysis results instead
                            const mainIssue = staticIssues.codeUnderstanding.potentialBugs[0];
                            this.rootCauseProvider.refresh({
                                description: "Static analysis detected potential bug",
                                explanation: mainIssue,
                                confidence: 0.85,
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
                        }
                        else {
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
                    }
                    else if (!staticIssues || !staticIssues.suggestions) {
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
                }
                else {
                    // Show simplified analysis if no root causes were found
                    this.showSimpleAnalysis(topVars, causalGraph);
                }
                // Show recent anomaly explanations
                const recentExplanations = this.dataCollector.getRecentAnomalyExplanations(3);
                if (recentExplanations.length > 0) {
                    this.showAnomalyExplanations(recentExplanations);
                }
            }
            else {
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
                    console.log("Static analysis issues (fallback):", ((_e = (_d = staticIssues === null || staticIssues === void 0 ? void 0 : staticIssues.codeUnderstanding) === null || _d === void 0 ? void 0 : _d.potentialBugs) === null || _e === void 0 ? void 0 : _e.length) || 0);
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
                    }
                    else {
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
        }
        catch (error) {
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
    generateCodeFromSuggestion(suggestion) {
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
        }
        else if (suggestion.includes("empty") || suggestion.includes("check")) {
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
        }
        else {
            return `// Suggested fix based on analysis:
// ${suggestion}`;
        }
    }
    async showRootCauseAnalysis(rootCauses) {
        // Show a comprehensive root cause analysis with AI-generated insights
        const panel = vscode.window.createWebviewPanel('rootCauseAnalysis', 'AI Root Cause Analysis', vscode.ViewColumn.Active, {
            enableScripts: true
        });
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
            if (cause.confidence > 0.7)
                confidenceClass = 'high';
            if (cause.confidence < 0.4)
                confidenceClass = 'low';
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
        vscode.window.showInformationMessage(`AI Root Cause Analysis complete: ${rootCauses.length} potential root causes identified.`, 'View Report').then(selection => {
            if (selection === 'View Report') {
                panel.reveal();
            }
        });
    }
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    showSimpleAnalysis(topVars, causalGraph) {
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
    showAnomalyExplanations(explanations) {
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
    async setBreakpoints(breakpoints, documentUri) {
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
    async setVSCodeBreakpoint(bp) {
        // Create a VS Code breakpoint
        const location = new vscode.Location(bp.uri, new vscode.Position(bp.line, bp.column));
        // Create either a basic breakpoint or a conditional breakpoint
        let vscodeBreakpoint;
        // Check if we should set a conditional breakpoint based on LLM insights
        let condition = '';
        // If we have LLM insights suggesting a specific condition, use that
        if (bp.llmInsights) {
            for (const insight of bp.llmInsights) {
                // Look for insights that mention conditions
                if (insight.includes('condition:')) {
                    condition = insight.split('condition:')[1].trim();
                    break;
                }
            }
        }
        if (condition) {
            vscodeBreakpoint = new vscode.SourceBreakpoint(location, true, // enabled
            condition, // logical condition
            undefined, // hit condition
            bp.id // id
            );
        }
        else {
            vscodeBreakpoint = new vscode.SourceBreakpoint(location, true, // enabled
            undefined, // no condition
            undefined, // hit condition
            bp.id // id
            );
        }
        // Store the breakpoint
        this.activeBreakpoints.set(bp.id, vscodeBreakpoint);
        // Add the breakpoint to VS Code
        vscode.debug.addBreakpoints([vscodeBreakpoint]);
        // Add a decoration to show this is an intelligent breakpoint
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === bp.uri.toString());
        if (editor) {
            const decorationType = vscode.window.createTextEditorDecorationType({
                before: {
                    contentText: '🧠 ',
                    color: 'green'
                },
                isWholeLine: true
            });
            const range = new vscode.Range(new vscode.Position(bp.line, 0), new vscode.Position(bp.line, 0));
            editor.setDecorations(decorationType, [range]);
        }
    }
    dispose() {
        // Clean up resources
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
exports.DebuggerIntegration = DebuggerIntegration;
//# sourceMappingURL=debuggerIntegration.js.map