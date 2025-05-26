import * as vscode from 'vscode';
import { LLMService } from '../llmService';
import { DataCollector } from '../dataCollector';
import { CodeAnalyzer } from '../codeAnalyzer';
import { IntelligentDebugCommand } from './intelligentDebugCommand';

export class PromptVariableCommand {
    private context: vscode.ExtensionContext;
    private llmService: LLMService;
    private dataCollector: DataCollector;
    private codeAnalyzer: CodeAnalyzer;
    private responsePanel: vscode.WebviewPanel | undefined;
    private intelligentDebugCommand: IntelligentDebugCommand;

    constructor(
        context: vscode.ExtensionContext,
        llmService: LLMService,
        dataCollector: DataCollector,
        codeAnalyzer: CodeAnalyzer,
        intelligentDebugCommand?: IntelligentDebugCommand
    ) {
        this.context = context;
        this.llmService = llmService;
        this.dataCollector = dataCollector;
        this.codeAnalyzer = codeAnalyzer;
        this.intelligentDebugCommand = intelligentDebugCommand;

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('intelligent-debugger.askAboutSelectedVariable', 
                this.handleSelectedVariable, this)
        );
        
        context.subscriptions.push(
            vscode.commands.registerCommand('intelligent-debugger.promptVariable', 
                this.handlePromptVariable, this)
        );
    }
    
    /**
     * Handle asking about a selected variable in the editor
     */
    private async handleSelectedVariable(): Promise<void> {
        // Get active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }
        
        // Get the selected text (variable)
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('No variable selected');
            return;
        }
        
        const variableName = editor.document.getText(selection);
        
        // Check if we're in an active debug session
        const debugSession = vscode.debug.activeDebugSession;
        if (!debugSession) {
            vscode.window.showErrorMessage('No active debug session');
            return;
        }
        
        // Get the prompt from the user
        const prompt = await vscode.window.showInputBox({
            prompt: `What would you like to know about '${variableName}'?`,
            placeHolder: "E.g., Why is it null? How did it get this value? What's causing it to change?"
        });
        
        if (!prompt) return;
        
        // Show a loading indicator
        await this.showAnswer(variableName, prompt, "Analyzing...");
        
        try {
            // Get the currently active stack frame
            const stackFrames = await this.getStackFrames(debugSession);
            if (!stackFrames || stackFrames.length === 0) {
                vscode.window.showErrorMessage('No stack frames available');
                return;
            }
            
            const topFrame = stackFrames[0];
            
            // Gather contextual information
            const variables = await this.getVariables(debugSession, topFrame);
            const sourceLocation = editor.document.uri.fsPath + ':' + (selection.start.line + 1);
            
            // Get the variable value
            const variableValue = variables[variableName];
            
            // Get code context: current function or block
            const codeContext = this.getCodeContext(
                editor.document.getText(),
                selection.start.line
            );
            
            // Get variable history from data collector
            const variableHistory = this.getVariableHistory(variableName);
            
            // Prepare the answer using LLM
            const answer = await this.generateVariableInsight(
                variableName,
                variableValue,
                prompt,
                codeContext,
                variables,
                variableHistory
            );
            
            // Show the answer
            await this.showAnswer(variableName, prompt, answer);
            
        } catch (error) {
            console.error("Error analyzing variable:", error);
            vscode.window.showErrorMessage(`Error analyzing variable: ${error.message}`);
        }
    }
    
    /**
     * Handle prompting about any variable in the current debug context
     */
    private async handlePromptVariable(): Promise<void> {
        // Check if we're in an active debug session
        const debugSession = vscode.debug.activeDebugSession;
        if (!debugSession) {
            vscode.window.showErrorMessage('No active debug session');
            return;
        }
        
        try {
            // Get the currently active stack frame
            const stackFrames = await this.getStackFrames(debugSession);
            if (!stackFrames || stackFrames.length === 0) {
                vscode.window.showErrorMessage('No stack frames available');
                return;
            }
            
            const topFrame = stackFrames[0];
            
            // Get all available variables
            const variables = await this.getVariables(debugSession, topFrame);
            
            // Let user select a variable
            const variableNames = Object.keys(variables).filter(name => 
                !name.startsWith('__') && name !== 'this'
            );
            
            if (variableNames.length === 0) {
                vscode.window.showErrorMessage('No variables available in current context');
                return;
            }
            
            // Show quickpick with variable preview values
            const items = variableNames.map(name => ({
                label: name,
                description: `${typeof variables[name] === 'object' ? 'Object' : variables[name]}`,
                detail: `Type: ${typeof variables[name]}`
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a variable to ask about',
                matchOnDescription: true,
                matchOnDetail: true
            });
            
            if (!selected) return;
            
            const variableName = selected.label;
            
            // Get the prompt from the user
            const prompt = await vscode.window.showInputBox({
                prompt: `What would you like to know about '${variableName}'?`,
                placeHolder: "E.g., Why is it null? How did it get this value? What's causing it to change?"
            });
            
            if (!prompt) return;
            
            // Show a loading indicator
            await this.showAnswer(variableName, prompt, "Analyzing...");
            
            // Get code context
            const editor = await this.openCurrentSourceLocation(topFrame);
            const codeContext = editor ? 
                this.getCodeContext(editor.document.getText(), editor.selection.start.line) : 
                "No code context available";
            
            // Get variable history from data collector
            const variableHistory = this.getVariableHistory(variableName);
            
            // Prepare the answer using LLM
            const answer = await this.generateVariableInsight(
                variableName,
                variables[variableName],
                prompt,
                codeContext,
                variables,
                variableHistory
            );
            
            // Show the answer
            await this.showAnswer(variableName, prompt, answer);
            
        } catch (error) {
            console.error("Error analyzing variable:", error);
            vscode.window.showErrorMessage(`Error analyzing variable: ${error.message}`);
        }
    }
    
    /**
     * Get all stack frames from the debug session
     */
    private async getStackFrames(debugSession: vscode.DebugSession): Promise<any[]> {
        try {
            const stackTraceResponse = await debugSession.customRequest('stackTrace', { 
                threadId: await this.getThreadId(debugSession) 
            });
            return stackTraceResponse.stackFrames || [];
        } catch (error) {
            console.error("Error getting stack frames:", error);
            return [];
        }
    }
    
    /**
     * Get the current thread ID
     */
    private async getThreadId(debugSession: vscode.DebugSession): Promise<number> {
        try {
            const threadsResponse = await debugSession.customRequest('threads', {});
            const threads = threadsResponse.threads || [];
            if (threads.length > 0) {
                return threads[0].id;
            }
            throw new Error('No threads available');
        } catch (error) {
            console.error("Error getting threads:", error);
            throw error;
        }
    }

    /**
 * Public method to analyze a variable by name
 */
public async askAboutVariable(variableName: string): Promise<void> {
    // Check if we're in an active debug session
    const debugSession = vscode.debug.activeDebugSession;
    if (!debugSession) {
        vscode.window.showErrorMessage('No active debug session');
        return;
    }
    
    // Get the prompt from the user
    const prompt = await vscode.window.showInputBox({
        prompt: `What would you like to know about '${variableName}'?`,
        placeHolder: "E.g., Why is it null? How did it get this value? What's causing it to change?"
    });
    
    if (!prompt) return;
    
    // Show a loading indicator
    await this.showAnswer(variableName, prompt, "Analyzing...");
    
    try {
        // Get the currently active stack frame
        const stackFrames = await this.getStackFrames(debugSession);
        if (!stackFrames || stackFrames.length === 0) {
            vscode.window.showErrorMessage('No stack frames available');
            return;
        }
        
        const topFrame = stackFrames[0];
        
        // Gather contextual information
        const variables = await this.getVariables(debugSession, topFrame);
        
        // Get code context
        const editor = await this.openCurrentSourceLocation(topFrame);
        const codeContext = editor ? 
            this.getCodeContext(editor.document.getText(), editor.selection.start.line) : 
            "No code context available";
        
        // Get variable history from data collector
        const variableHistory = this.getVariableHistory(variableName);
        
        // Prepare the answer using LLM
        const answer = await this.generateVariableInsight(
            variableName,
            variables[variableName],
            prompt,
            codeContext,
            variables,
            variableHistory
        );
        
        // Show the answer
        await this.showAnswer(variableName, prompt, answer);
        
    } catch (error) {
        console.error("Error analyzing variable:", error);
        vscode.window.showErrorMessage(`Error analyzing variable: ${error.message}`);
    }
}
    
/**
 * Open the debug source location and return the editor
 */
private async openCurrentSourceLocation(stackFrame: any): Promise<vscode.TextEditor | undefined> {
    if (!stackFrame.source || !stackFrame.source.path) {
        return undefined;
    }
    
    try {
        // Check if the file is already open in an editor
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.fsPath === stackFrame.source.path) {
                // File is already open, just focus this editor
                await vscode.window.showTextDocument(editor.document, {
                    viewColumn: editor.viewColumn,
                    preserveFocus: false
                });
                
                // Move cursor to the current line
                const position = new vscode.Position(stackFrame.line - 1, stackFrame.column);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
                
                return editor;
            }
        }
        
        // File is not open yet, open it
        const document = await vscode.workspace.openTextDocument(stackFrame.source.path);
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false
        });
        
        // Move cursor to the current line
        const position = new vscode.Position(stackFrame.line - 1, stackFrame.column);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
        
        return editor;
    } catch (error) {
        console.error("Error opening source location:", error);
        return undefined;
    }
}
    /**
     * Get all variables in the current stack frame
     */
    private async getVariables(
        debugSession: vscode.DebugSession, 
        stackFrame: any
    ): Promise<Record<string, any>> {
        const variables: Record<string, any> = {};
        
        try {
            // Get all scopes
            const scopesResponse = await debugSession.customRequest('scopes', {
                frameId: stackFrame.id
            });
            
            const scopes = scopesResponse.scopes || [];
            
            // For each scope, get all variables
            for (const scope of scopes) {
                if (scope.variablesReference) {
                    const varsResponse = await debugSession.customRequest('variables', {
                        variablesReference: scope.variablesReference
                    });
                    
                    for (const variable of varsResponse.variables || []) {
                        variables[variable.name] = variable.value;
                        
                        // If it's an object with children, fetch one level of nested properties
                        if (variable.variablesReference && 
                            variable.variablesReference !== scope.variablesReference) {
                            try {
                                const nestedVarsResponse = await debugSession.customRequest('variables', {
                                    variablesReference: variable.variablesReference
                                });
                                
                                variables[variable.name] = {};
                                for (const nestedVar of nestedVarsResponse.variables || []) {
                                    variables[variable.name][nestedVar.name] = nestedVar.value;
                                }
                            } catch (error) {
                                console.log(`Couldn't fetch nested properties for ${variable.name}:`, error);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error getting variables:", error);
        }
        
        return variables;
    }
    
    /**
     * Get the code context around the current position
     */
    private getCodeContext(code: string, lineNumber: number): string {
        const lines = code.split('\n');
        
        // Try to find the containing function or block
        let startLine = Math.max(0, lineNumber - 10);
        let endLine = Math.min(lines.length - 1, lineNumber + 10);
        
        // Extract the relevant code snippet
        return lines.slice(startLine, endLine + 1).join('\n');
    }
    
    /**
     * Get the history of a variable from previous breakpoint hits
     */
    private getVariableHistory(variableName: string): any[] {
        const history: any[] = [];
        
        // Get all data series
        const allSeries = this.dataCollector.getAllDataSeries();
        
        // For each series, look for the variable in each data point
        for (const series of allSeries) {
            for (const dataPoint of series.data) {
                for (const variable of dataPoint.variables) {
                    if (variable.name === variableName) {
                        history.push({
                            timestamp: dataPoint.timestamp,
                            value: variable.value,
                            breakpointId: dataPoint.breakpointId,
                            iterationCount: dataPoint.iterationCount
                        });
                    }
                }
            }
        }
        
        // Sort by timestamp, newest first
        return history.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    
    // Modify the generateVariableInsight method to use trimmed variables

private async generateVariableInsight(
    variableName: string,
    variableValue: any,
    userPrompt: string,
    codeContext: string,
    allVariables: Record<string, any>,
    variableHistory: any[]
): Promise<string> {
    try {
        // Get the most informative/relevant variables using your existing logic
        const relevantVariables: Record<string, any> = {};
        
        // Extract the top N most informative variables using the same logic
        // from your IntelligentDebugCommand's findMostInformativeVariables method
        const topVars = this.findMostInformativeVariables(allVariables);
        
        // Add the target variable if it's not already in the top variables
        relevantVariables[variableName] = variableValue;
        
        // Add the top variables
        for (const [name, value] of topVars) {
            if (name !== variableName) { // Avoid duplicate
                relevantVariables[name] = value;
            }
        }
        
        // Build the system prompt for the LLM
        const systemPrompt = 
            "You are an expert debugging assistant specialized in explaining variable behavior " +
            "in code. Analyze the variable, its context, history, and related code to provide " +
            "clear, comprehensive explanations about why variables have certain values or behaviors. " +
            "Be specific, use code examples when helpful, and focus on answering the user's question " +
            "with technical precision. Format your answer with Markdown for readability.";
        
        // Build the main prompt with all contextual information
        const prompt = `
# Variable Analysis Request

## Variable: ${variableName}
## Current Value: ${JSON.stringify(variableValue, null, 2)}
## User Question: "${userPrompt}"

## Code Context:
\`\`\`
${codeContext}
\`\`\`

## Most Relevant Related Variables:
\`\`\`json
${JSON.stringify(this.simplifyVariables(relevantVariables), null, 2)}
\`\`\`

${variableHistory.length > 0 ? `
## Variable History:
\`\`\`json
${JSON.stringify(variableHistory.slice(0, 5), null, 2)}
\`\`\`
` : ''}

Please analyze the variable "${variableName}" and answer the user's question: "${userPrompt}".
Provide a clear explanation based on the code context, current value, and history.
Include:
1. Direct answer to the user's question
2. Analysis of how the variable got its current value
3. Any potential issues or unexpected behavior
4. Suggestions for debugging or fixing issues if applicable

Use Markdown formatting in your response to improve readability.
`;

        // Call the LLM service
        const response = await this.llmService.callLLM(prompt, systemPrompt);
        return response;
        
    } catch (error) {
        console.error("Error generating variable insight:", error);
        return `Error generating insight: ${error.message}`;
    }
}

    /**
     * Find the most informative variables in the current context
     * This reuses your existing logic from IntelligentDebugCommand
     */
    private findMostInformativeVariables(variables: Record<string, any>): [string, any][] {
        const varEntries = Object.entries(variables);
        if (this.intelligentDebugCommand && typeof this.intelligentDebugCommand.findMostInformativeVariables === 'function') {
            return this.intelligentDebugCommand.findMostInformativeVariables(variables);
        }
        // Skip system/internal variables
        const filteredVars = varEntries.filter(([name]) => 
            !name.startsWith('__') && 
            !name.startsWith('this') && 
            name !== 'arguments'
        );
        
        // Score variables by informativeness
        const scoredVars = filteredVars.map(([name, value]) => {
            let score = 0;
            
            // Variables that often indicate state
            if (['i', 'j', 'index', 'key', 'count'].includes(name)) score += 3;
            if (['value', 'result', 'sum', 'total'].includes(name)) score += 4;
            if (['error', 'exception', 'status'].includes(name)) score += 5;
            
            // Complex objects may be more informative
            if (typeof value === 'object' && value !== null) score += 2;
            
            // Arrays with content
            if (Array.isArray(value) && value.length > 0) score += 3;
            
            // Use execution context insights if available
            // Check if this variable has been involved in any anomalies
            const anomalyData = this.getAnomalyDataForVariable(name);
            if (anomalyData) {
                score += 5; // Significant boost for variables with anomalies
            }
            
            // Check if variable is new or recently changed
            const historyData = this.getVariableHistory(name);
            if (historyData.length > 1 && this.hasRecentlyChanged(historyData)) {
                score += 4; // Boost for recently changed variables
            }
            
            return { name, value, score };
        });
        
        // Sort by score (highest first) and take top 5
        return scoredVars
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(({ name, value }) => [name, value]);
    }

    /**
     * Check if the DataCollector has anomaly data for this variable
     */
    private getAnomalyDataForVariable(variableName: string): any {
        // Check all data series for anomalies involving this variable
        const allSeries = this.dataCollector.getAllDataSeries();
        for (const series of allSeries) {
            const stats = series.variableStatistics.get(variableName);
            if (stats && stats.anomalies && stats.anomalies.length > 0) {
                return stats.anomalies;
            }
        }
        return null;
    }

    /**
     * Check if a variable has changed value recently
     */
    private hasRecentlyChanged(history: any[]): boolean {
        if (history.length < 2) return false;
        
        // Check if the last two values are different
        const latest = history[0]?.value;
        const previous = history[1]?.value;
        
        // Simple comparison - in a more sophisticated implementation,
        // you might want to do a deep comparison for objects
        return latest !== previous;
    }

    
    /**
     * Show the answer in a webview panel
     */
    private async showAnswer(
        variableName: string, 
        userQuestion: string, 
        answer: string
    ): Promise<void> {
        // Create or show the panel
        if (!this.responsePanel) {
            this.responsePanel = vscode.window.createWebviewPanel(
                'variableInsight',
                'Variable Insight',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    enableFindWidget: true
                }
            );
            
            // Dispose handler
            this.responsePanel.onDidDispose(() => {
                this.responsePanel = undefined;
            });
        }
        
        // Create webview content
        const content = /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Variable Insight</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.5;
                }
                h1 {
                    color: var(--vscode-editor-foreground);
                    font-size: 1.5em;
                    margin-bottom: 0.5em;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 5px;
                }
                .variable-name {
                    color: var(--vscode-symbolIcon-variableForeground);
                    font-family: var(--vscode-editor-font-family);
                    font-weight: bold;
                }
                .question {
                    margin-bottom: 20px;
                    font-style: italic;
                    color: var(--vscode-descriptionForeground);
                    background-color: var(--vscode-textBlockQuote-background);
                    padding: 10px;
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                }
                .answer {
                    margin-top: 20px;
                    line-height: 1.6;
                }
                code {
                    font-family: var(--vscode-editor-font-family);
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                }
                pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 10px;
                    border-radius: 5px;
                    overflow-x: auto;
                    margin: 10px 0;
                }
                blockquote {
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    margin: 0;
                    padding-left: 10px;
                    color: var(--vscode-textBlockQuote-foreground);
                }
                .loading {
                    display: flex;
                    align-items: center;
                    color: var(--vscode-descriptionForeground);
                }
                .loading::after {
                    content: '';
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--vscode-progressBar-background);
                    border-top-color: transparent;
                    border-radius: 50%;
                    margin-left: 10px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                /* Markdown formatting */
                .answer h1 { font-size: 1.4em; margin-top: 20px; margin-bottom: 10px; }
                .answer h2 { font-size: 1.3em; margin-top: 18px; margin-bottom: 9px; }
                .answer h3 { font-size: 1.2em; margin-top: 16px; margin-bottom: 8px; }
                .answer ul, .answer ol { padding-left: 20px; }
                .answer table { border-collapse: collapse; width: 100%; }
                .answer th, .answer td { border: 1px solid var(--vscode-panel-border); padding: 6px; }
                .answer th { background-color: var(--vscode-editor-inactiveSelectionBackground); }
            </style>
        </head>
        <body>
            <h1>Variable Insight: <span class="variable-name">${this.escapeHtml(variableName)}</span></h1>
            <div class="question">
                "${this.escapeHtml(userQuestion)}"
            </div>
            <div class="answer ${answer === 'Analyzing...' ? 'loading' : ''}">
                ${this.markdownToHtml(answer)}
            </div>
            <script>
                // Add syntax highlighting or other interactive features if needed
            </script>
        </body>
        </html>
        `;
        
        // Update the webview content
        this.responsePanel.webview.html = content;
        this.responsePanel.reveal(vscode.ViewColumn.Beside);
    }
    
    /**
     * Helper to escape HTML special characters
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    /**
     * Convert markdown to HTML (simple version)
     */
    private markdownToHtml(markdown: string): string {
        if (!markdown) return '';
        
        // For simplicity, we'll just handle code blocks and basic formatting
        // In a production extension, you would use a proper markdown renderer
        
        // Handle code blocks
        let html = markdown.replace(/```([a-z]*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${this.escapeHtml(code)}</code></pre>`;
        });
        
        // Handle inline code
        html = html.replace(/`([^`]+)`/g, (_, code) => {
            return `<code>${this.escapeHtml(code)}</code>`;
        });
        
        // Handle headers
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        
        // Handle paragraphs
        html = html.replace(/^\s*(\n)?(.+)/gm, function(m) {
            return /\<(\/)?(h1|h2|h3|pre|ol|ul|li)/.test(m) ? m : '<p>' + m + '</p>';
        });
        
        // Handle lists
        html = html.replace(/^\s*\*\s*(.*)/gm, '<li>$1</li>');
        // Wrap lists
        html = html.replace(/<li>(.*)<\/li>\s*<li>/g, '<li>$1</li>\n<li>');
        html = html.replace(/<li>(.*)<\/li>/g, '<ul><li>$1</li></ul>');
        html = html.replace(/<\/ul>\s*<ul>/g, '');
        
        // Handle bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // Handle italic
        html = html.replace(/\*([^\s].*?)\*/g, '<em>$1</em>');
        
        // Handle links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Remove empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        
        return html;
    }
    
    /**
     * Simplify variables for display (limit depth)
     */
    private simplifyVariables(variables: Record<string, any>, depth: number = 1): Record<string, any> {
        if (depth <= 0) return variables;
        
        const result: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(variables)) {
            if (typeof value === 'object' && value !== null) {
                if (depth > 1) {
                    result[key] = this.simplifyVariables(value, depth - 1);
                } else {
                    // At max depth, just indicate it's an object
                    if (Array.isArray(value)) {
                        result[key] = `Array[${value.length}]`;
                    } else {
                        result[key] = `Object{${Object.keys(value).length} props}`;
                    }
                }
            } else {
                result[key] = value;
            }
        }
        
        return result;
    }
}