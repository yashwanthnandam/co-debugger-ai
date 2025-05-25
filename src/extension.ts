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

// Track project analysis status
let analyzedFileCount = 0;
let totalFilesToAnalyze = 0;

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
                
                // Try to show insights panel with command that exists
                try {
                    await vscode.commands.executeCommand('intelligent-debugger.viewInsights');
                } catch (e) {
                    // Silently ignore if command not found
                }
                
                // Also focus debug panel if it exists
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

    
    // Register workspace analysis command (new command for project-wide analysis)
    let analyzeWorkspaceCmd = vscode.commands.registerCommand('intelligent-debugger.analyzeWorkspace', async () => {
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
                    `Workspace analysis complete. Analyzed ${analyzedFileCount} files.`,
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        DebugInsightsPanel.createOrShow(context.extensionUri);
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
                vscode.window.showErrorMessage(`Workspace analysis failed: ${error.message}`);
            }
        });
    });
    
    // Register start analysis command (enhanced with project context)
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
                
                // Update tree views with breakpoints data - ONLY REFRESH ONCE
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
                    'View Details',
                    'Analyze Entire Project'
                ).then(selection => {
                    if (selection === 'View Details') {
                        DebugInsightsPanel.createOrShow(context.extensionUri);
                    } else if (selection === 'Analyze Entire Project') {
                        vscode.commands.executeCommand('intelligent-debugger.analyzeWorkspace');
                    }
                });
            } catch (error) {
                console.error("Error analyzing code:", error);
                vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
            }
        });
    });

    // Enhanced test debug command with project context
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

        // Create a helper test file to test project context
        const helperTestCode = `
    // Helper functions for debug testing
    
    /**
     * Sorts and processes an array
     */
    export function processArray(arr) {
        return arr.slice().sort((a, b) => a - b);
    }
    
    /**
     * Finds the maximum value in an array
     */
    export function findMax(numbers) {
        if (!numbers || numbers.length === 0) return undefined;
        
        let max = numbers[0];
        for (let i = 0; i < numbers.length; i++) {
            if (numbers[i] > max) {
                max = numbers[i];
            }
        }
        
        return max;
    }
    `;
    
        // Save to temp files
        const tmpDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
        const testFilePath = path.join(tmpDir, 'debug-test.js');
        const helperFilePath = path.join(tmpDir, 'helper-functions.js');
        
        fs.writeFileSync(testFilePath, testCode);
        fs.writeFileSync(helperFilePath, helperTestCode);
        
        // Update main test to import helper
        const updatedTestCode = `
    // Test file for debugging
    const { processArray, findMax } = require('./helper-functions');
    
    function main() {
        console.log("Debug test starting");
        
        // Test data to observe
        const testArray = [5, 9, 3, 1, 7];
        let max = findMax(testArray);
        
        // Also test with processed array
        const processed = processArray(testArray);
        console.log("Processed array:", processed);
        
        console.log("Max value:", max);
    }
    
    main();
    `;
        
        fs.writeFileSync(testFilePath, updatedTestCode);
        
        // Open the main file
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        const editor = await vscode.window.showTextDocument(doc);
        
        // Set a breakpoint in the main function
        const breakpointPosition = new vscode.Position(6, 0);
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
        
        vscode.window.showInformationMessage('Starting test debugging session with project context...');
        
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
        // When explicitly requesting to view insights, always show the panel
        const { DebugInsightsPanel } = require('./views/debugInsightsPanel');
        DebugInsightsPanel.createOrShow(context.extensionUri, true);
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
        analyzeWorkspaceCmd,
        setCustomPromptCmd,
        viewInsightsCmd,
        configureLLMCmd,
        testDebugCmd,
        debuggerIntegration
    );
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