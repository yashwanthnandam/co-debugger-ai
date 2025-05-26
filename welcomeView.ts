import * as vscode from 'vscode';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
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
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body { padding: 10px; font-family: var(--vscode-font-family); }
                .title { font-size: 1.2em; margin-bottom: 10px; }
                .step { margin-bottom: 15px; }
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
                    margin-top: 5px;
                }
            </style>
        </head>
        <body>
            <div class="title">🐞 CoDebugger.ai Workflow</div>
            
            <div class="step">
                <span class="step-number">1</span>
                <b>Analyze Your Code</b>
                <div>Analyze your current file or entire project to set intelligent breakpoints</div>
                <button class="step-button" onclick="runCommand('codebugger.analyzeFile')">
                    Analyze Current File
                </button>
                <button class="step-button" onclick="runCommand('codebugger.analyzeProject')">
                    Analyze Project
                </button>
            </div>
            
            <div class="step">
                <span class="step-number">2</span>
                <b>Start Debugging</b>
                <div>Run your code with AI-powered debugging enabled</div>
                <button class="step-button" onclick="runCommand('codebugger.startDebugging')">
                    Start Debugging
                </button>
            </div>
            
            <div class="step">
                <span class="step-number">3</span>
                <b>Review Insights</b>
                <div>View AI analysis of your debugging session</div>
                <button class="step-button" onclick="runCommand('codebugger.viewInsights')">
                    View Insights
                </button>
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