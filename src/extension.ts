import * as vscode from 'vscode';
import { CodeAnalyzer } from './codeAnalyzer';
import { BreakpointManager } from './breakpointManager';
import { DataCollector } from './dataCollector';
import { DebuggerIntegration } from './debuggerIntegration';
import { ConversationalPrompts } from './conversationalPrompts';
import { DebugInsightsPanel } from './views/debugInsightsPanel';
import { LLMService } from './llmService';
import { CausalAnalysis } from './causalAnalysis';
import { InformationGainAnalyzer } from './informationGain';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from './treeDataProviders';

// Create a single instance of the LLM service to be shared
let llmService: LLMService;

// Create tree view providers to be used globally
let breakpointsProvider: BreakpointsProvider;
let rootCauseProvider: RootCauseProvider;
let fixSuggestionsProvider: FixSuggestionsProvider;
let debugInsightsProvider: DebugInsightsProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Intelligent Debugger extension is now active');

    // Initialize LLM service
    llmService = new LLMService();
    
    // Initialize core components
    const codeAnalyzer = new CodeAnalyzer(llmService);
    const breakpointManager = new BreakpointManager(codeAnalyzer, llmService);
    const dataCollector = new DataCollector(llmService);
    const causalAnalyzer = new CausalAnalysis(dataCollector, llmService, codeAnalyzer);
    const infoGainAnalyzer = new InformationGainAnalyzer(dataCollector);
    
    // Initialize and register tree data providers
    breakpointsProvider = new BreakpointsProvider();
    rootCauseProvider = new RootCauseProvider();
    fixSuggestionsProvider = new FixSuggestionsProvider();
    debugInsightsProvider = new DebugInsightsProvider();

    // Initialize with default data
    breakpointsProvider.refresh([{
        location: 'No breakpoints set',
        reason: 'Run analysis to set intelligent breakpoints',
        score: 0
    }]);
    
    rootCauseProvider.refresh({
        description: 'No root cause analysis available',
        explanation: 'Debug your code to analyze potential issues',
        confidence: 0,
        relatedCode: [],
        potentialFixes: []
    });
    
    fixSuggestionsProvider.refresh([{
        description: 'No fix suggestions available',
        code: '// Run analysis and debug your code to get fix suggestions',
        impact: 'N/A',
        confidence: 0
    }]);
    
    debugInsightsProvider.refresh([{
        title: 'No debug data available',
        description: 'Start debugging your code to see insights'
    }]);

    // Register the tree data providers with VS Code
    vscode.window.registerTreeDataProvider('debugBreakpoints', breakpointsProvider);
    vscode.window.registerTreeDataProvider('rootCauses', rootCauseProvider);
    vscode.window.registerTreeDataProvider('llmSuggestions', fixSuggestionsProvider);
    vscode.window.registerTreeDataProvider('debugInsights', debugInsightsProvider);
    
    const debuggerIntegration = new DebuggerIntegration(
        breakpointManager, 
        dataCollector,
        causalAnalyzer,
        infoGainAnalyzer,
        llmService
    );
    
    // Pass tree data providers to debugger integration for updating
    debuggerIntegration.setTreeProviders(
        breakpointsProvider, 
        rootCauseProvider, 
        fixSuggestionsProvider,
        debugInsightsProvider
    );
    
    const promptManager = new ConversationalPrompts(context, llmService);

    // Register LLM configuration command
    let configureLLMCmd = vscode.commands.registerCommand('intelligent-debugger.configureLLM', async () => {
        await llmService.configureLLM();
    });

    // Register start analysis command
    let startAnalysisCmd = vscode.commands.registerCommand('intelligent-debugger.startAnalysis', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing code structure...",
            cancellable: true
        }, async (progress) => {
            progress.report({ increment: 0 });
            
            try {
                // Step 1: Analyze the code and build flow graph
                const document = editor.document;
                progress.report({ increment: 10, message: "Analyzing code with AI..." });
                await codeAnalyzer.analyzeCode(document.getText(), document.fileName);
                progress.report({ increment: 20, message: "Building code flow graph" });
                
                // Step 2: Calculate heuristic scores for potential breakpoints
                progress.report({ increment: 20, message: "Scoring potential debug points" });
                await breakpointManager.rankBreakpoints();
                
                // Step 3: Set intelligent breakpoints
                const topBreakpoints = await breakpointManager.getTopBreakpoints();
                progress.report({ increment: 20, message: "Setting intelligent breakpoints" });
                await debuggerIntegration.setBreakpoints(topBreakpoints, document.uri);
                
                // Step 4: Share code snippets with data collector for context
                progress.report({ increment: 20, message: "Preparing debugging context" });
                for (const [nodeId, node] of codeAnalyzer.getNodes().entries()) {
                    const snippet = codeAnalyzer.getCodeSnippet(nodeId);
                    if (snippet) {
                        dataCollector.setCodeSnippet(nodeId, snippet);
                    }
                }
                
                // Update tree views with breakpoints data - ONLY REFRESH ONCE
                if (topBreakpoints.length > 0) {
                    breakpointsProvider.refresh(topBreakpoints.map(bp => ({
                        location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                        reason: bp.reason || 'Intelligent analysis',
                        score: bp.score
                    })));
                }
                
                progress.report({ increment: 10, message: "Ready for intelligent debugging" });
                
                vscode.window.showInformationMessage(
                    `Analysis complete. ${topBreakpoints.length} intelligent breakpoints set.`,
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        DebugInsightsPanel.createOrShow(context.extensionUri);
                    }
                });
            } catch (error) {
                console.error("Error analyzing code:", error);
                vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
            }
        });
    });

    

    // Register custom prompt command
    let setCustomPromptCmd = vscode.commands.registerCommand('intelligent-debugger.setCustomPrompt', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const lineNumber = editor.selection.active.line;
        const prompt = await vscode.window.showInputBox({
            prompt: `Enter a custom prompt for line ${lineNumber + 1}`,
            placeHolder: 'E.g., Why is this variable value changing unexpectedly?'
        });

        if (prompt) {
            const expectedValue = await vscode.window.showInputBox({
                prompt: 'Enter expected value or behavior (optional)',
                placeHolder: 'E.g., Value should be positive or < 100'
            });

            await promptManager.setPrompt(editor.document.uri, lineNumber, prompt, expectedValue || '');
            
            // Show confirmation with enhanced details
            const enhancedPrompt = await promptManager.getPrompt(editor.document.uri, lineNumber);
            if (enhancedPrompt?.enhancedDetails) {
                const message = 
                    `Custom prompt set for line ${lineNumber + 1}\n\n` +
                    `AI enhanced understanding:\n` +
                    `- ${enhancedPrompt.enhancedDetails.enhancedPrompt}\n\n` +
                    `Key variables to watch: ${enhancedPrompt.enhancedDetails.relevantVariables.join(', ')}`;
                
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showInformationMessage(`Custom prompt set for line ${lineNumber + 1}`);
            }
        }
    });

    // Register view insights command
    let viewInsightsCmd = vscode.commands.registerCommand('intelligent-debugger.viewInsights', () => {
        DebugInsightsPanel.createOrShow(context.extensionUri);
    });

    // Register debug session event handlers
    debuggerIntegration.registerEventHandlers();

    // Add all disposables to context
    context.subscriptions.push(
        startAnalysisCmd,
        setCustomPromptCmd,
        viewInsightsCmd,
        configureLLMCmd,
        debuggerIntegration
    );
}

export function deactivate() {
    // Clean up resources
}