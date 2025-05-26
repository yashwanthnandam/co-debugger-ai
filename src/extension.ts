import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeAnalyzer } from './codeAnalyzer';
import { IntelligentDebugCommand } from './commands/intelligentDebugCommand';
import { BreakpointManager } from './breakpointManager';
import { DataCollector } from './dataCollector';
import { DebuggerIntegration } from './debuggerIntegration/debuggerIntegration';
import { ConversationalPrompts } from './conversationalPrompts';
import { LLMService } from './llmService';
import { CausalAnalysis } from './causalAnalysis';
import { InformationGainAnalyzer } from './informationGain';
import { BreakpointsProvider, RootCauseProvider, FixSuggestionsProvider, DebugInsightsProvider } from './treeDataProviders';
import { PromptVariableCommand } from './commands/promptVariableCommand';
import { BreakpointRanker } from './algorithms/breakPointRanker';
import { ConfigurationWizard } from './configurationWizard';

// Welcome view provider for getting started
class WelcomeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codebugger.welcomeView';
    
    constructor(private readonly extensionUri: vscode.Uri) {}
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        
        webviewView.webview.html = this.getHtmlContent();
        
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command) {
                await vscode.commands.executeCommand(data.command);
            }
        });
    }
    
    private getHtmlContent() {
        const currentDate = "2025-05-26 03:22:00";
        
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body { padding: 10px; font-family: var(--vscode-font-family); }
                .title { font-size: 1.2em; margin-bottom: 10px; }
                .step { margin-bottom: 20px; }
                .step-number {
                    display: inline-block;
                    width: 24px;
                    height: 24px;
                    line-height: 24px;
                    text-align: center;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-radius: 12px;
                    margin-right: 8px;
                }
                .step-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-top: 8px;
                    margin-right: 8px;
                }
                .step-desc {
                    margin: 8px 0;
                    opacity: 0.8;
                }
                .footer {
                    font-size: 0.8em;
                    opacity: 0.6;
                    margin-top: 20px;
                    border-top: 1px solid var(--vscode-panel-border);
                    padding-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="title">🐞 CoDebugger.ai Workflow</div>
            
            <div class="step">
                <span class="step-number">1</span>
                <b>Configure AI</b>
                <div class="step-desc">Set up your LLM provider and API key</div>
                <button class="step-button" onclick="runCommand('codebugger.configure')">
                    Configure AI Settings
                </button>
            </div>
            
            <div class="step">
                <span class="step-number">2</span>
                <b>Analyze Your Code</b>
                <div class="step-desc">Analyze your code to set intelligent breakpoints</div>
                <button class="step-button" onclick="runCommand('codebugger.analyzeFile')">
                    Analyze Current File
                </button>
                <button class="step-button" onclick="runCommand('codebugger.analyzeProject')">
                    Analyze Project
                </button>
            </div>
            
            <div class="step">
                <span class="step-number">3</span>
                <b>Start Debugging</b>
                <div class="step-desc">Run your code with AI-powered debugging</div>
                <button class="step-button" onclick="runCommand('codebugger.startDebugging')">
                    Start Debugging
                </button>
            </div>
            
            <div class="step">
                <span class="step-number">4</span>
                <b>Ask Questions</b>
                <div class="step-desc">Ask about variables during debugging</div>
                <button class="step-button" onclick="runCommand('codebugger.askVariable')">
                    Ask About Variable
                </button>
            </div>
            
            <div class="footer">
                CoDebugger.ai v0.1.3 | Updated: ${currentDate}
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                function runCommand(command) {
                    vscode.postMessage({ command });
                }
            </script>
        </body>
        </html>`;
    }
}

// Create a single instance of the LLM service to be shared
let llmService: LLMService;

// Create tree view providers to be used globally
let breakpointsProvider: BreakpointsProvider;
let rootCauseProvider: RootCauseProvider;
let fixSuggestionsProvider: FixSuggestionsProvider;
let debugInsightsProvider: DebugInsightsProvider;
const breakpointRanker = new BreakpointRanker();

// Track project analysis status
let analyzedFileCount = 0;
let totalFilesToAnalyze = 0;

export function activate(context: vscode.ExtensionContext) {
    console.log('CoDebugger.ai extension is now active');
console.log(`Activation time: 2025-05-26 03:27:04`);
console.log(`User: yashwanthnandamworking version`);

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
        breakpointRanker,
        llmService,
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
    vscode.window.registerTreeDataProvider('debugger.breakpoints', breakpointsProvider);
    vscode.window.registerTreeDataProvider('debugger.insights', debugInsightsProvider);
    vscode.window.registerTreeDataProvider('rootCauses', rootCauseProvider);
    vscode.window.registerTreeDataProvider('llmSuggestions', fixSuggestionsProvider);
    
    // Register sidebar views with the same providers but different IDs
    vscode.window.registerTreeDataProvider('codebugger.breakpoints', breakpointsProvider);
    vscode.window.registerTreeDataProvider('codebugger.insights', debugInsightsProvider);
    
    const debuggerIntegration = new DebuggerIntegration(
        breakpointManager, 
        dataCollector,
        causalAnalyzer,
        infoGainAnalyzer,
        llmService,
        intelligentDebugCommand, // Pass promptVariableCommand
    );
    
    // Pass tree data providers to debugger integration for updating
    debuggerIntegration.setTreeProviders(
        breakpointsProvider, 
        rootCauseProvider, 
        fixSuggestionsProvider,
        debugInsightsProvider
    );
    
    const promptManager = new ConversationalPrompts(context, llmService);

    // Register Welcome View
    const welcomeViewProvider = new WelcomeViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            WelcomeViewProvider.viewType,
            welcomeViewProvider
        )
    );

    // Add quick actions menu to status bar
    const quickActionsButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    quickActionsButton.text = "$(debug-console) CoDebugger";
    quickActionsButton.tooltip = "CoDebugger.ai Quick Actions";
    quickActionsButton.command = "codebugger.showQuickActions";
    context.subscriptions.push(quickActionsButton);
    quickActionsButton.show();

    // SIMPLIFIED COMMANDS REGISTRATION

    // 1. Analyze Current File command
    let analyzeFileCmd = vscode.commands.registerCommand('codebugger.analyzeFile', async () => {
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
                
                // Check if this file has already been analyzed
                const alreadyAnalyzed = codeAnalyzer.isFileAnalyzed(document.fileName);
                
                // Analyze current file
                await codeAnalyzer.analyzeCode(document.getText(), document.fileName);
                progress.report({ increment: 20, message: "Building code flow graph" });
                
                // Step 2: If file was not previously analyzed, try to find related files
                if (!alreadyAnalyzed && vscode.workspace.workspaceFolders) {
                    progress.report({ 
                        increment: 5, 
                        message: "Discovering related files..." 
                    });
                    
                    // Get dependencies from code analyzer
                    const dependencies = codeAnalyzer.getFileDependencies(document.fileName) || [];
                    
                    // Analyze a small batch of related files for context
                    let relatedFilesAnalyzed = 0;
                    for (const depFile of dependencies.slice(0, 3)) {
                        try {
                            if (!codeAnalyzer.isFileAnalyzed(depFile)) {
                                const content = await fs.promises.readFile(depFile, 'utf8');
                                await codeAnalyzer.analyzeCode(content, depFile);
                                relatedFilesAnalyzed++;
                                
                                progress.report({ 
                                    message: `Analyzing related file ${relatedFilesAnalyzed}/${Math.min(dependencies.length, 3)}` 
                                });
                            }
                        } catch (err) {
                            console.log(`Could not analyze dependency: ${depFile}`, err);
                            // Continue with other files if one fails
                        }
                    }
                    
                    if (relatedFilesAnalyzed > 0) {
                        progress.report({ 
                            increment: 5, 
                            message: `Analyzed ${relatedFilesAnalyzed} related files for context` 
                        });
                    }
                }
                
                // Step 3: Calculate heuristic scores for potential breakpoints
                progress.report({ increment: 15, message: "Scoring potential debug points" });
                await breakpointManager.rankBreakpoints();
                
                // Step 4: Set intelligent breakpoints
                const topBreakpoints = await breakpointManager.getTopBreakpoints();
                progress.report({ increment: 15, message: "Setting intelligent breakpoints" });
                await debuggerIntegration.setBreakpoints(topBreakpoints, document.uri);
                
                // Step 5: Share code snippets with data collector for context
                progress.report({ increment: 15, message: "Preparing debugging context" });
                for (const [nodeId, node] of codeAnalyzer.getNodes().entries()) {
                    const snippet = codeAnalyzer.getCodeSnippet(nodeId);
                    if (snippet) {
                        dataCollector.setCodeSnippet(nodeId, snippet);
                    }
                }
                
                // Update tree views with breakpoints data
                if (topBreakpoints.length > 0) {
                    breakpointsProvider.refresh(topBreakpoints.map(bp => ({
                        location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                        reason: bp.reason || 'Intelligent analysis',
                        score: bp.score
                    })));
                }
                
                // Step 6: Update project context for LLM
                progress.report({ increment: 10, message: "Updating project context for AI" });
                await debuggerIntegration.provideProjectContext(document.fileName, llmService);
                
                progress.report({ increment: 10, message: "Ready for intelligent debugging" });
                
                vscode.window.showInformationMessage(
                    `Analysis complete. ${topBreakpoints.length} intelligent breakpoints set.`,
                    'Start Debugging'
                ).then(selection => {
                    if (selection === 'Start Debugging') {
                        vscode.commands.executeCommand('codebugger.startDebugging');
                    }
                });
            } catch (error) {
                console.error("Error analyzing code:", error);
                vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
            }
        });
    });

    // 2. Analyze Project command
    let analyzeProjectCmd = vscode.commands.registerCommand('codebugger.analyzeProject', async () => {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder is open');
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing workspace...",
            cancellable: true
        }, async (progress, token) => {
            progress.report({ increment: 0, message: "Finding relevant files..." });
            
            try {
                // Step 1: Find all JavaScript/TypeScript files in the workspace
                const files = await findCodeFiles(workspaceRoot, token);
                totalFilesToAnalyze = files.length;
                analyzedFileCount = 0;
                
                if (totalFilesToAnalyze === 0) {
                    vscode.window.showInformationMessage('No JavaScript/TypeScript files found in workspace');
                    return;
                }
                
                progress.report({ 
                    increment: 10, 
                    message: `Found ${totalFilesToAnalyze} files to analyze` 
                });
                
                // Step 2: Analyze key files first (entry points, active file)
                const activeEditor = vscode.window.activeTextEditor;
                const activeFile = activeEditor?.document.uri.fsPath;
                
                // Move active file to the front of the queue if it exists
                if (activeFile) {
                    const activeFileIndex = files.findIndex(file => file === activeFile);
                    if (activeFileIndex >= 0) {
                        files.splice(activeFileIndex, 1);
                        files.unshift(activeFile);
                    }
                }
                
                // Step 3: Analyze files in batches
                const batchSize = 5;
                const totalBatches = Math.ceil(files.length / batchSize);
                
                for (let i = 0; i < totalBatches; i++) {
                    if (token.isCancellationRequested) {
                        vscode.window.showInformationMessage('Analysis cancelled');
                        return;
                    }
                    
                    const batch = files.slice(i * batchSize, (i + 1) * batchSize);
                    const batchPromises = batch.map(async (file) => {
                        try {
                            // Skip if already analyzed
                            if (codeAnalyzer.isFileAnalyzed(file)) {
                                return;
                            }
                            
                            const content = await fs.promises.readFile(file, 'utf8');
                            await codeAnalyzer.analyzeCode(content, file);
                            analyzedFileCount++;
                            
                            const progressPercent = Math.min(90, 10 + (analyzedFileCount / totalFilesToAnalyze * 80));
                            progress.report({ 
                                increment: progressPercent / totalBatches, 
                                message: `Analyzed ${analyzedFileCount}/${totalFilesToAnalyze} files` 
                            });
                        } catch (error) {
                            console.error(`Error analyzing file ${file}:`, error);
                            // Continue with other files even if one fails
                        }
                    });
                    
                    await Promise.all(batchPromises);
                }
                
                // Step 4: Set breakpoints on the active file if one is open
                progress.report({ 
                    increment: 5,
                    message: "Setting intelligent breakpoints..." 
                });
                
                if (activeEditor) {
                    await breakpointManager.rankBreakpoints();
                    const topBreakpoints = await breakpointManager.getTopBreakpoints();
                    await debuggerIntegration.setBreakpoints(topBreakpoints, activeEditor.document.uri);
                    
                    // Update tree view with breakpoints data
                    if (topBreakpoints.length > 0) {
                        breakpointsProvider.refresh(topBreakpoints.map(bp => ({
                            location: `${bp.uri.fsPath.split('/').pop()}:${bp.line + 1}`,
                            reason: bp.reason || 'Intelligent analysis',
                            score: bp.score
                        })));
                    }
                }
                
                progress.report({ increment: 5, message: "Finalizing analysis..." });
                
                // Step 5: Show analysis results
                vscode.window.showInformationMessage(
                    `Project analysis complete. Analyzed ${analyzedFileCount} files.`,
                    'Start Debugging'
                ).then(selection => {
                    if (selection === 'Start Debugging') {
                        vscode.commands.executeCommand('codebugger.startDebugging');
                    }
                });
                
                debugInsightsProvider.refresh([
                    {
                        title: 'Project Analysis Complete',
                        description: `Analyzed ${analyzedFileCount} files across the project`
                    },
                    {
                        title: 'Ready for Debugging',
                        description: 'Intelligent breakpoints have been set based on project-wide understanding'
                    }
                ]);
                
            } catch (error) {
                console.error("Error analyzing workspace:", error);
                vscode.window.showErrorMessage(`Project analysis failed: ${error.message}`);
            }
        });
    });

    // 3. Start Debugging command
    let startDebuggingCmd = vscode.commands.registerCommand('codebugger.startDebugging', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        try {
            // Check if breakpoints are set or need to be set
            const breakpoints = breakpointManager.getBreakpointsForUri(editor.document.uri);
            if (!breakpoints || breakpoints.length === 0) {
                const shouldAnalyze = await vscode.window.showInformationMessage(
                    'No intelligent breakpoints set for this file. Analyze first?',
                    'Yes, Analyze File',
                    'No, Just Debug'
                );
                
                if (shouldAnalyze === 'Yes, Analyze File') {
                    await vscode.commands.executeCommand('codebugger.analyzeFile');
                    return; // The debugging will be triggered after analysis
                }
            }

            // Start the debugging session
            vscode.commands.executeCommand('workbench.action.debug.start');
            
            // Show notification that AI debugging is active
            vscode.window.showInformationMessage(
                'CoDebugger.ai is now actively monitoring your debugging session'
            );

        } catch (error) {
            console.error('Error starting debug session:', error);
            vscode.window.showErrorMessage(`Failed to start debugging: ${error.message}`);
        }
    });

    // 5. Ask Variable command
    let askVariableCmd = vscode.commands.registerCommand('codebugger.askVariable', async () => {
        if (!vscode.debug.activeDebugSession) {
            vscode.window.showErrorMessage('No active debugging session');
            return;
        }
        
        const variableName = await vscode.window.showInputBox({
            prompt: 'Enter variable name to analyze',
            placeHolder: 'e.g., counter, userInput, data'
        });
        
        if (!variableName) return;
        
        try {
            await promptVariableCommand.askAboutVariable(variableName);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to analyze variable: ${error.message}`);
        }
    });

    // 6. Ask Selected Variable command
    let askSelectedVariableCmd = vscode.commands.registerCommand('codebugger.askSelectedVariable', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !vscode.debug.activeDebugSession) {
            vscode.window.showErrorMessage('No active editor or debugging session');
            return;
        }
        
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No text selected');
            return;
        }
        
        try {
            await promptVariableCommand.askAboutVariable(selectedText);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to analyze variable: ${error.message}`);
        }
    });

    // 7. Configure AI Settings command
    let configureCmd = vscode.commands.registerCommand('codebugger.configure', async () => {
        try {
            const config = await ConfigurationWizard.collectParameters();
            if (config) {
                // Update the LLM service with new configuration
                await llmService.updateConfiguration(config);
                vscode.window.showInformationMessage('AI configuration updated successfully!');
                
                // Update status bar
                updateLlmStatus();
                
                // Guide user to next step
                const nextStep = await vscode.window.showInformationMessage(
                    'AI configuration complete! What would you like to do next?',
                    'Analyze File',
                    'Analyze Project'
                );
                
                if (nextStep === 'Analyze File') {
                    await vscode.commands.executeCommand('codebugger.analyzeFile');
                } else if (nextStep === 'Analyze Project') {
                    await vscode.commands.executeCommand('codebugger.analyzeProject');
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Configuration error: ${error.message}`);
        }
    });

    // 8. Quick Actions command
    let quickActionsCmd = vscode.commands.registerCommand('codebugger.showQuickActions', async () => {
        const actions = [
            { label: "$(search) Analyze Current File", id: "analyzeFile" },
            { label: "$(search-view-icon) Analyze Entire Project", id: "analyzeProject" },
            { label: "$(debug-start) Start AI-Powered Debugging", id: "startDebugging" },
            { label: "$(question) Ask About Variable", id: "askVariable" },
            { label: "$(settings-gear) Configure AI Settings", id: "configure" }
        ];
        
        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: "Select a CoDebugger.ai action"
        });
        
        if (selected) {
            await vscode.commands.executeCommand(`codebugger.${selected.id}`);
        }
    });
    
    // Register backward compatibility aliases - SAFER APPROACH
    try {
        vscode.commands.registerCommand('intelligent-debugger.startAnalysis', () => 
            vscode.commands.executeCommand('codebugger.analyzeFile'));
        vscode.commands.registerCommand('intelligent-debugger.analyzeWorkspace', () => 
            vscode.commands.executeCommand('codebugger.analyzeProject'));
        vscode.commands.registerCommand('intelligent-debugger.promptVariable', () => 
            vscode.commands.executeCommand('codebugger.askVariable'));
        vscode.commands.registerCommand('intelligent-debugger.askAboutSelectedVariable', () => 
            vscode.commands.executeCommand('codebugger.askSelectedVariable'));
        vscode.commands.registerCommand('intelligent-debugger.configureLLM', () => 
            vscode.commands.executeCommand('codebugger.configure'));
    } catch (err) {
        // Silently ignore registration errors for backward compatibility commands
        console.log('Note: Some backward compatibility commands could not be registered');
    }

    // Register debug session event handlers
    debuggerIntegration.registerEventHandlers();

    // Show AI configuration status in status bar
    const llmStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    llmStatusBarItem.text = "$(settings-gear) Configure AI";
    llmStatusBarItem.tooltip = "Configure AI settings for intelligent debugging";
    llmStatusBarItem.command = "codebugger.configure";
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
        analyzeFileCmd,
        analyzeProjectCmd,
        startDebuggingCmd,
        askVariableCmd,
        askSelectedVariableCmd,
        configureCmd,
        quickActionsCmd,
        debuggerIntegration
    );

    // Show a welcome message on first activation
    const hasShownWelcome = context.globalState.get('codebugger.hasShownWelcome');
    if (!hasShownWelcome) {
        setTimeout(() => {
            vscode.window.showInformationMessage(
                'Welcome to CoDebugger.ai! Start by configuring your AI settings.',
                'Configure Now', 
                'Show Tutorial'
            ).then(selection => {
                if (selection === 'Configure Now') {
                    vscode.commands.executeCommand('codebugger.configure');
                } else if (selection === 'Show Tutorial') {
                    vscode.commands.executeCommand('workbench.view.extension.codebugger-sidebar');
                }
            });
            context.globalState.update('codebugger.hasShownWelcome', true);
        }, 2000);
    }
}

/**
 * Find all JavaScript/TypeScript files in a directory
 */
async function findCodeFiles(rootDir: string, token: vscode.CancellationToken): Promise<string[]> {
    const files: string[] = [];
    const ignore = [
        'node_modules',
        'dist',
        'build',
        '.git',
        '.vscode',
        'coverage'
    ];
    
    async function scanDir(dir: string) {
        if (token.isCancellationRequested) return;
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (token.isCancellationRequested) return;
                
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip ignored directories
                    if (!ignore.includes(entry.name)) {
                        await scanDir(fullPath);
                    }
                } else if (entry.isFile()) {
                    // Check if it's a JavaScript/TypeScript file
                    const ext = path.extname(entry.name).toLowerCase();
                    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (err) {
            console.error(`Error scanning directory ${dir}:`, err);
        }
    }
    
    await scanDir(rootDir);
    return files;
}

export function deactivate() {
    // Clean up resources
}