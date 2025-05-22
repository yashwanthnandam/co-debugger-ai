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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const codeAnalyzer_1 = require("./codeAnalyzer");
const breakpointManager_1 = require("./breakpointManager");
const dataCollector_1 = require("./dataCollector");
const debuggerIntegration_1 = require("./debuggerIntegration");
const conversationalPrompts_1 = require("./conversationalPrompts");
const debugInsightsPanel_1 = require("./views/debugInsightsPanel");
const llmService_1 = require("./llmService");
const causalAnalysis_1 = require("./causalAnalysis");
const informationGain_1 = require("./informationGain");
const treeDataProviders_1 = require("./treeDataProviders");
// Create a single instance of the LLM service to be shared
let llmService;
// Create tree view providers to be used globally
let breakpointsProvider;
let rootCauseProvider;
let fixSuggestionsProvider;
let debugInsightsProvider;
function activate(context) {
    console.log('Intelligent Debugger extension is now active');
    // Initialize LLM service
    llmService = new llmService_1.LLMService();
    // Initialize core components
    const codeAnalyzer = new codeAnalyzer_1.CodeAnalyzer(llmService);
    const breakpointManager = new breakpointManager_1.BreakpointManager(codeAnalyzer, llmService);
    const dataCollector = new dataCollector_1.DataCollector(llmService);
    const causalAnalyzer = new causalAnalysis_1.CausalAnalysis(dataCollector, llmService, codeAnalyzer);
    const infoGainAnalyzer = new informationGain_1.InformationGainAnalyzer(dataCollector);
    // Initialize and register tree data providers
    breakpointsProvider = new treeDataProviders_1.BreakpointsProvider();
    rootCauseProvider = new treeDataProviders_1.RootCauseProvider();
    fixSuggestionsProvider = new treeDataProviders_1.FixSuggestionsProvider();
    debugInsightsProvider = new treeDataProviders_1.DebugInsightsProvider();
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
    const debuggerIntegration = new debuggerIntegration_1.DebuggerIntegration(breakpointManager, dataCollector, causalAnalyzer, infoGainAnalyzer, llmService);
    // Pass tree data providers to debugger integration for updating
    debuggerIntegration.setTreeProviders(breakpointsProvider, rootCauseProvider, fixSuggestionsProvider, debugInsightsProvider);
    const promptManager = new conversationalPrompts_1.ConversationalPrompts(context, llmService);
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
                vscode.window.showInformationMessage(`Analysis complete. ${topBreakpoints.length} intelligent breakpoints set.`, 'View Details').then(selection => {
                    if (selection === 'View Details') {
                        debugInsightsPanel_1.DebugInsightsPanel.createOrShow(context.extensionUri);
                    }
                });
            }
            catch (error) {
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
            if (enhancedPrompt === null || enhancedPrompt === void 0 ? void 0 : enhancedPrompt.enhancedDetails) {
                const message = `Custom prompt set for line ${lineNumber + 1}\n\n` +
                    `AI enhanced understanding:\n` +
                    `- ${enhancedPrompt.enhancedDetails.enhancedPrompt}\n\n` +
                    `Key variables to watch: ${enhancedPrompt.enhancedDetails.relevantVariables.join(', ')}`;
                vscode.window.showInformationMessage(message);
            }
            else {
                vscode.window.showInformationMessage(`Custom prompt set for line ${lineNumber + 1}`);
            }
        }
    });
    // Register view insights command
    let viewInsightsCmd = vscode.commands.registerCommand('intelligent-debugger.viewInsights', () => {
        debugInsightsPanel_1.DebugInsightsPanel.createOrShow(context.extensionUri);
    });
    // Register debug session event handlers
    debuggerIntegration.registerEventHandlers();
    // Add all disposables to context
    context.subscriptions.push(startAnalysisCmd, setCustomPromptCmd, viewInsightsCmd, configureLLMCmd, debuggerIntegration);
}
exports.activate = activate;
function deactivate() {
    // Clean up resources
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map