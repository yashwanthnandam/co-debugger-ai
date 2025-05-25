import * as vscode from 'vscode';

export class DebugInsightsPanel {
    /**
     * Track the currently panel. Only allow a single panel to exist at a time.
     */
    public static currentPanel: DebugInsightsPanel | undefined;

    private static readonly viewType = 'debugInsights';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _content: string = ''; // Store the content

    public static createOrShow(extensionUri: vscode.Uri, showPanel: boolean = true) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, just update it and optionally show it
        if (DebugInsightsPanel.currentPanel) {
            if (showPanel) {
                DebugInsightsPanel.currentPanel._panel.reveal(column);
            }
            return DebugInsightsPanel.currentPanel;
        }

        // Otherwise, create a new panel but only show it if showPanel is true
        const panel = vscode.window.createWebviewPanel(
            DebugInsightsPanel.viewType,
            'Debug Insights',
            showPanel ? (column || vscode.ViewColumn.One) : { viewColumn: column || vscode.ViewColumn.One, preserveFocus: true },
            {
                // Enable JavaScript in the webview
                enableScripts: true,
                // Restrict the webview to only loading content from our extension's directory
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true // Keep the panel loaded when hidden
            }
        );

        DebugInsightsPanel.currentPanel = new DebugInsightsPanel(panel, extensionUri);
        // If showPanel is false, the panel will be created in the background (preserveFocus: true)
        return DebugInsightsPanel.currentPanel;
    }

    public static updateContent(content: string | undefined) {
        if (DebugInsightsPanel.currentPanel) {
            DebugInsightsPanel.currentPanel._content = content || '';
            DebugInsightsPanel.currentPanel._update();
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        DebugInsightsPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = "Debug Insights";
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // If we have custom content, use it
        if (this._content) {
            return this._content;
        }

        // Otherwise use the default
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
                <p>No debugging data available yet. Run your code with intelligent debugging enabled to see insights.</p>
            </body>
            </html>`;
    }
}