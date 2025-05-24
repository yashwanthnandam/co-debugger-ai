import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * A multi-step input form for collecting AI configuration parameters
 */
export class ConfigurationWizard {
    static async collectParameters(): Promise<any | undefined> {
        const config = vscode.workspace.getConfiguration('intelligentDebugger');
        
        // Step 1: Choose LLM provider
        const providers = ['openai', 'anthropic', 'google', 'local'];
        const provider = await vscode.window.showQuickPick(providers, {
            placeHolder: 'Select AI provider',
            title: 'Step 1/4: Select AI Provider',
            ignoreFocusOut: true
        });
        
        if (!provider) return undefined; // User canceled
        
        // Step 2: Enter API key
        const currentKey = config.get(`${provider}ApiKey`, '');
        const apiKey = await vscode.window.showInputBox({
            prompt: `Enter your ${provider} API Key`,
            title: 'Step 2/4: API Key',
            password: true, // Hide the API key as it's typed
            value: currentKey,
            ignoreFocusOut: true,
            validateInput: text => {
                return text.length > 10 ? null : 'API Key appears too short';
            }
        });
        
        if (!apiKey) return undefined; // User canceled
        
        // Step 3: Select model based on provider
        const modelOptions = this.getModelOptionsForProvider(provider);
        const model = await vscode.window.showQuickPick(modelOptions, {
            placeHolder: `Select ${provider} model`,
            title: 'Step 3/4: Select Model',
            ignoreFocusOut: true
        });
        
        if (!model) return undefined; // User canceled
        
        // Step 4: Advanced settings (with defaults shown)
        const temperature = await vscode.window.showInputBox({
            prompt: 'Set temperature (0.0-1.0)',
            title: 'Step 4/4: Advanced Settings',
            value: config.get('temperature', '0.7').toString(),
            ignoreFocusOut: true,
            validateInput: text => {
                const num = parseFloat(text);
                return (num >= 0 && num <= 1) ? null : 'Temperature must be between 0.0 and 1.0';
            }
        });
        
        if (!temperature) return undefined; // User canceled
        
        // Save the configuration
        await config.update('llmProvider', provider, vscode.ConfigurationTarget.Global);
        await config.update('llmModel', model, vscode.ConfigurationTarget.Global);
        await config.update('temperature', parseFloat(temperature), vscode.ConfigurationTarget.Global);
        await config.update(`${provider}ApiKey`, apiKey, vscode.ConfigurationTarget.Global);
        
        return {
            provider,
            model,
            temperature: parseFloat(temperature),
            apiKey
        };
    }
    
    /**
     * Get model options based on the selected provider
     */
    private static getModelOptionsForProvider(provider: string): string[] {
        switch (provider) {
            case 'openai':
                return ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo'];
            case 'anthropic':
                return ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'];
            case 'google':
                return ['gemini-pro', 'gemini-pro-vision'];
            case 'local':
                return ['llama-3-8b', 'llama-3-70b', 'mistral-7b', 'custom'];
            default:
                return ['default-model'];
        }
    }
    
    /**
     * Create a credentials file directory if it doesn't exist yet
     */
    private static ensureCredentialsDirectory(): string {
        const credDir = path.join(os.homedir(), '.intelligent-debugger');
        if (!fs.existsSync(credDir)) {
            fs.mkdirSync(credDir, { recursive: true });
        }
        return credDir;
    }
}