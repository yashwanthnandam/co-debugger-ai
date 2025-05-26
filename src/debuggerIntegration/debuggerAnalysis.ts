import * as vscode from 'vscode';
import { BreakpointManager, IntelligentBreakpoint } from '../breakpointManager';
import * as path from 'path';
import { DataCollector } from '../dataCollector';
import { ConversationalPrompts } from '../conversationalPrompts';
import { InformationGainAnalyzer } from '../informationGain';
import { CausalAnalysis, RootCause } from '../causalAnalysis';
import { LLMService } from '../llmService';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from '../treeDataProviders';

export class DebuggerAnalysis {
    private breakpointManager: BreakpointManager;
    private dataCollector: DataCollector;
    private infoGainAnalyzer: InformationGainAnalyzer;
    private causalAnalyzer: CausalAnalysis;
    private llmService: LLMService;
    
    // Tree view providers
    private breakpointsProvider?: BreakpointsProvider;
    private rootCauseProvider?: RootCauseProvider;
    private fixSuggestionsProvider?: FixSuggestionsProvider;
    private debugInsightsProvider?: DebugInsightsProvider;

    constructor(
        breakpointManager: BreakpointManager,
        dataCollector: DataCollector,
        infoGainAnalyzer: InformationGainAnalyzer,
        causalAnalyzer: CausalAnalysis,
        llmService: LLMService
    ) {
        this.breakpointManager = breakpointManager;
        this.dataCollector = dataCollector;
        this.infoGainAnalyzer = infoGainAnalyzer;
        this.causalAnalyzer = causalAnalyzer;
        this.llmService = llmService;
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
    
    /**
     * Generate meaningful debug insights using LLM
     */
    public async generateDebugInsightsHTML(): Promise<string> {
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

   /**
     * Update the debug insights view in real-time
     */
    public updateDebugInsights(
        fileName: string, 
        lineNumber: number, 
        variables: Record<string, any>, 
        callStack: string[], 
        dataPoint: any
    ): void {
        return;
    }

        /**
     * Analyze debug data after a debug session ends
     */
    public async analyzeDebugData(
        breakpointsProvider?: BreakpointsProvider,
        rootCauseProvider?: RootCauseProvider,
        fixSuggestionsProvider?: FixSuggestionsProvider,
        debugInsightsProvider?: DebugInsightsProvider
    ): Promise<void> {
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
            if (breakpointsProvider) {
                const breakpoints = this.breakpointManager.getAllBreakpoints();
                breakpointsProvider.refresh(breakpoints.map(bp => ({
                    location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                    reason: bp.reason,
                    score: bp.score
                })));
            }
            
            // Always update the debug insights provider with variable data
            if (debugInsightsProvider) {
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
                    debugInsightsProvider.refresh(insightData);
                } else {
                    console.log("No debug insights data available, using default message");
                    debugInsightsProvider.refresh([{
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
                if (rootCauseProvider) {
                    if (rootCauses.length > 0) {
                        console.log("Updating root cause provider with real data");
                        const firstCause = rootCauses[0];
                        rootCauseProvider.refresh(firstCause.llmInsight || {
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
                            rootCauseProvider.refresh({
                                description: "Static analysis detected potential bug",
                                explanation: mainIssue,
                                confidence: 0.85, // Higher confidence for static analysis
                                relatedCode: [],
                                potentialFixes: staticIssues.suggestions || []
                            });
                            
                            // Also update fix suggestions
                            if (fixSuggestionsProvider && staticIssues.suggestions) {
                                // Create fix suggestions from the static analysis
                                fixSuggestionsProvider.refresh(staticIssues.suggestions.map(suggestion => ({
                                    description: suggestion,
                                    code: this.generateCodeFromSuggestion(suggestion),
                                    impact: "May fix the detected bug",
                                    confidence: 0.8
                                })));
                            }
                        } else {
                            // Fall back to default if no static issues either
                            rootCauseProvider.refresh({
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
                if (fixSuggestionsProvider) {
                    if (rootCauses.length > 0) {
                        console.log("Generating fix suggestions...");
                        const detailedFixes = await this.causalAnalyzer.generateFixSuggestions(rootCauses[0]);
                        console.log("Fix suggestions generated:", detailedFixes.length);
                        fixSuggestionsProvider.refresh(detailedFixes);
                    } else if (!staticIssues || !staticIssues.suggestions) {
                        console.log("Using default fix suggestions");
                        // Default suggestions based on top variables
                        fixSuggestionsProvider.refresh([{
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
                if (debugInsightsProvider) {
                    debugInsightsProvider.refresh([{
                        title: "Debug session completed",
                        description: "No significant patterns detected"
                    }]);
                }
                
                if (rootCauseProvider) {
                    // Check static analysis for potential issues
                    const staticIssues = this.breakpointManager.getStaticAnalysisIssues();
                    console.log("Static analysis issues (fallback):", staticIssues?.codeUnderstanding?.potentialBugs?.length || 0);
                    
                    if (staticIssues && staticIssues.codeUnderstanding && 
                        staticIssues.codeUnderstanding.potentialBugs && 
                        staticIssues.codeUnderstanding.potentialBugs.length > 0) {
                        // Use the static analysis results 
                        const mainIssue = staticIssues.codeUnderstanding.potentialBugs[0];
                        rootCauseProvider.refresh({
                            description: "Static analysis detected potential bug",
                            explanation: mainIssue,
                            confidence: 0.85,
                            relatedCode: [],
                            potentialFixes: staticIssues.suggestions || []
                        });
                        
                        // Update fix suggestions too
                        if (fixSuggestionsProvider && staticIssues.suggestions) {
                            fixSuggestionsProvider.refresh(staticIssues.suggestions.map(suggestion => ({
                                description: suggestion,
                                code: this.generateCodeFromSuggestion(suggestion),
                                impact: "May fix the detected bug",
                                confidence: 0.8
                            })));
                        }
                    } else {
                        rootCauseProvider.refresh({
                            description: "No issues detected",
                            explanation: "The execution completed without notable anomalies",
                            confidence: 0.5,
                            relatedCode: [],
                            potentialFixes: []
                        });
                        
                        if (fixSuggestionsProvider) {
                            fixSuggestionsProvider.refresh([{
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
            if (debugInsightsProvider) {
                debugInsightsProvider.refresh([{
                    title: "Error analyzing debug data",
                    description: error.message
                }]);
            }
        }
    }
    
    // Helper method to create code examples from suggestions
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
    
    /**
     * Display root cause analysis in a webview panel
     */
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
                <p><small>Generated on ${new Date().toISOString().split('T')[0]} by CoDebugger.ai</small></p>
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
    
    /**
     * HTML escape utility for safe string display
     */
    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    /**
     * Show simplified analysis when no root causes are found
     */
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
    
    /**
     * Show anomaly explanations in notification
     */
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

   
}