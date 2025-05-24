import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeAnalyzer } from './codeAnalyzer';
import { IntelligentDebugCommand } from './commands/intelligentDebugCommand';
import { BreakpointManager } from './breakpointManager';
import { DataCollector } from './dataCollector';
import { DebuggerIntegration } from './debuggerIntegration';
import { ConversationalPrompts } from './conversationalPrompts';
import { DebugInsightsPanel } from './views/debugInsightsPanel';
import { LLMService } from './llmService';
import { CausalAnalysis } from './causalAnalysis';
import { InformationGainAnalyzer } from './informationGain';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from './treeDataProviders';
import { PromptVariableCommand } from './commands/promptVariableCommand';
import { BreakpointRanker } from './algorithms/breakPointRanker';
import { ConfigurationWizard } from './configurationWizard';

// Create a single instance of the LLM service to be shared
let llmService: LLMService;

// Create tree view providers to be used globally
let breakpointsProvider: BreakpointsProvider;
let rootCauseProvider: RootCauseProvider;
let fixSuggestionsProvider: FixSuggestionsProvider;
let debugInsightsProvider: DebugInsightsProvider;
const breakpointRanker = new BreakpointRanker();

export function activate(context: vscode.ExtensionContext) {
    console.log('intelligent-debugger extension is now active');

    // Initialize LLM service
    llmService = new LLMService();
    
    // Initialize core components
    const codeAnalyzer = new CodeAnalyzer(llmService);
    const breakpointManager = new BreakpointManager(codeAnalyzer, llmService);
    const dataCollector = new DataCollector(llmService);
    const causalAnalyzer = new CausalAnalysis(dataCollector, llmService, codeAnalyzer);
    const infoGainAnalyzer = new InformationGainAnalyzer(dataCollector);
    debugInsightsProvider = new DebugInsightsProvider();
    const intelligentDebugCommand = new IntelligentDebugCommand(
        context,
        codeAnalyzer,
        breakpointManager,
        dataCollector,
        debugInsightsProvider,
        breakpointRanker
    );

    const promptVariableCommand = new PromptVariableCommand(
        context,
        llmService,
        dataCollector,
        codeAnalyzer,
        intelligentDebugCommand,
    );
    // Initialize and register tree data providers
    breakpointsProvider = new BreakpointsProvider();
    rootCauseProvider = new RootCauseProvider();
    fixSuggestionsProvider = new FixSuggestionsProvider();

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

    // Register LLM configuration command with the wizard
    let configureLLMCmd = vscode.commands.registerCommand('intelligent-debugger.configureLLM', async () => {
        try {
            const config = await ConfigurationWizard.collectParameters();
            if (config) {
                // Update the LLM service with new configuration
                await llmService.updateConfiguration(config);
                vscode.window.showInformationMessage('AI configuration updated successfully!');
                
                // REMOVE or FIX this line that's causing the error:
                // await vscode.commands.executeCommand('workbench.view.extension.intelligent-debugger-insights');
                
                // Instead, try one of these alternatives:
                // Option 1: Show debug insights if that command exists
                try {
                    await vscode.commands.executeCommand('intelligent-debugger.viewInsights');
                } catch (e) {
                    // Silently ignore if command not found
                }
                
                // Option 2: Simply focus the debug panel if it exists
                try {
                    await vscode.commands.executeCommand('workbench.view.debug');
                } catch (e) {
                    // Silently ignore if command not found
                }
                
                // Update status bar
                updateLlmStatus();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Configuration error: ${error.message}`);
        }
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

    let testDebugCmd = vscode.commands.registerCommand('intelligent-debugger.testDebug', async () => {
        // Create a simple test file
        const testCode = `
    // Test file for debugging
    function main() {
        console.log("Debug test starting");
        
        // Test data to observe
        const testArray = [5, 9, 3, 1, 7];
        let max = testArray[0];
        
        // Loop with a breakpoint (line 10)
        for (let i = 0; i < testArray.length; i++) {
            if (testArray[i] > max) {
                max = testArray[i];
            }
        }
        
        console.log("Max value:", max);
    }
    
    main();
    `;
    
        // Save to a temp file
        const tmpDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
        const testFilePath = path.join(tmpDir, 'debug-test.js');
        fs.writeFileSync(testFilePath, testCode);
        
        // Open the file
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        const editor = await vscode.window.showTextDocument(doc);
        
        // Set a breakpoint on the for loop (line 10)
        const breakpointPosition = new vscode.Position(9, 0);
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(doc.uri, breakpointPosition),
            true
        );
        
        // Clear existing breakpoints and add the new one
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        vscode.debug.addBreakpoints([breakpoint]);
        
        // Create a launch config
        const config = {
            type: 'node',
            request: 'launch',
            name: 'Debug Test',
            program: testFilePath,
            skipFiles: ['<node_internals>/**'],
            stopOnEntry: false
        };
        
        vscode.window.showInformationMessage('Starting test debugging session...');
        
        // First, analyze the code to set up intelligent debugging
        await vscode.commands.executeCommand('intelligent-debugger.startAnalysis');
        
        // Then start debugging
        await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config);
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

    // Show AI configuration status in status bar
    const llmStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    llmStatusBarItem.text = "$(settings-gear) Configure AI";
    llmStatusBarItem.tooltip = "Configure AI settings for intelligent debugging";
    llmStatusBarItem.command = "intelligent-debugger.configureLLM";
    context.subscriptions.push(llmStatusBarItem);
    llmStatusBarItem.show();

    // Update status bar with current AI configuration
    const updateLlmStatus = () => {
        const config = vscode.workspace.getConfiguration('intelligentDebugger');
        const provider = config.get('llmProvider');
        const model = config.get('llmModel');
        const apiKey = config.get(`${provider}ApiKey`, '');
        
        if (apiKey) {
            llmStatusBarItem.text = `$(check) ${provider}: ${model}`;
            llmStatusBarItem.backgroundColor = undefined;
        } else {
            llmStatusBarItem.text = `$(warning) AI Not Configured`;
            llmStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    };

    // Run initially and whenever configuration changes
    updateLlmStatus();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('intelligentDebugger')) {
            updateLlmStatus();
        }
    }));

    // Add all disposables to context
    context.subscriptions.push(
        startAnalysisCmd,
        setCustomPromptCmd,
        viewInsightsCmd,
        configureLLMCmd,
        testDebugCmd,
        debuggerIntegration
    );
}

export function deactivate() {
    // Clean up resources
}