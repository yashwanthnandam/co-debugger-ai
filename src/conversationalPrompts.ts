import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LLMService } from './llmService';

interface PromptEntry {
    uri: string;
    line: number;
    text: string;
    expectedValue: string;
    timestamp: number;
    enhancedDetails?: {
        relevantVariables: string[];
        checkConditions: string[];
        enhancedPrompt: string;
    };
}

export class ConversationalPrompts {
    private prompts: PromptEntry[] = [];
    private storageUri?: vscode.Uri;
    private llmService: LLMService;
    
    constructor(context?: vscode.ExtensionContext, llmService?: LLMService) {
        this.llmService = llmService || new LLMService();
        
        if (context) {
            this.storageUri = context.globalStorageUri;
            this.loadPrompts();
        }
    }
    
    private getStoragePath(): string | undefined {
        if (!this.storageUri) return undefined;
        
        const storagePath = path.join(this.storageUri.fsPath, 'prompts.json');
        
        // Ensure the directory exists
        const storageDir = path.dirname(storagePath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        
        return storagePath;
    }
    
    private loadPrompts(): void {
        const storagePath = this.getStoragePath();
        if (!storagePath || !fs.existsSync(storagePath)) return;
        
        try {
            const data = fs.readFileSync(storagePath, 'utf8');
            this.prompts = JSON.parse(data);
        } catch (error) {
            console.error('Error loading prompts:', error);
            this.prompts = [];
        }
    }
    
    private savePrompts(): void {
        const storagePath = this.getStoragePath();
        if (!storagePath) return;
        
        try {
            fs.writeFileSync(storagePath, JSON.stringify(this.prompts, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving prompts:', error);
        }
    }
    
    public async setPrompt(
        uri: vscode.Uri, 
        line: number, 
        text: string, 
        expectedValue: string
    ): Promise<void> {
        // Use LLM to enhance the prompt with semantic understanding
        const enhancedDetails = await this.enhancePromptWithLLM(uri, line, text, expectedValue);
        
        // Check if a prompt already exists for this location
        const existingIndex = this.prompts.findIndex(p => 
            p.uri === uri.toString() && p.line === line
        );
        
        if (existingIndex !== -1) {
            // Update existing prompt
            this.prompts[existingIndex] = {
                uri: uri.toString(),
                line,
                text,
                expectedValue,
                timestamp: Date.now(),
                enhancedDetails
            };
        } else {
            // Add new prompt
            this.prompts.push({
                uri: uri.toString(),
                line,
                text,
                expectedValue,
                timestamp: Date.now(),
                enhancedDetails
            });
        }
        
        // Save the updated prompts
        this.savePrompts();
    }
    
    private async enhancePromptWithLLM(
        uri: vscode.Uri,
        line: number,
        text: string,
        expectedValue: string
    ): Promise<{
        relevantVariables: string[];
        checkConditions: string[];
        enhancedPrompt: string;
    } | undefined> {
        try {
            // Get code context for the given location
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Extract code context (surrounding lines)
            const startLine = Math.max(0, line - 5);
            const endLine = Math.min(document.lineCount - 1, line + 5);
            
            let codeContext = '';
            for (let i = startLine; i <= endLine; i++) {
                const lineText = document.lineAt(i).text;
                codeContext += `${i === line ? '>' : ' '} ${lineText}\n`;
            }
            
            // Simulate current state (in a real implementation, this would use actual runtime values)
            const currentState: Record<string, any> = {};
            
            // Extract variable names from the code context using a simple regex
            const variableRegex = /\b(?:let|var|const)\s+(\w+)\b/g;
            let match;
            while ((match = variableRegex.exec(codeContext)) !== null) {
                currentState[match[1]] = "unknown";
            }
            
            // If expected value looks like a comparison, extract the variable
            const comparisonRegex = /\b(\w+)\s*[<>=!]=?\s*(.+)/;
            const comparisonMatch = expectedValue.match(comparisonRegex);
            if (comparisonMatch && comparisonMatch[1]) {
                currentState[comparisonMatch[1]] = "unknown";
            }
            
            // Enhance the prompt with LLM
            return await this.llmService.enhanceDebugPrompt(
                text,
                codeContext,
                currentState
            );
        } catch (error) {
            console.error('Error enhancing prompt with LLM:', error);
            return undefined;
        }
    }
    
    public async getPrompt(uri: vscode.Uri, line: number): Promise<{ 
        text: string, 
        expectedValue: string,
        enhancedDetails?: {
            relevantVariables: string[];
            checkConditions: string[];
            enhancedPrompt: string;
        }
    } | undefined> {
        const prompt = this.prompts.find(p => 
            p.uri === uri.toString() && p.line === line
        );
        
        if (prompt) {
            return {
                text: prompt.enhancedDetails?.enhancedPrompt || prompt.text,
                expectedValue: prompt.expectedValue,
                enhancedDetails: prompt.enhancedDetails
            };
        }
        
        return undefined;
    }
    
    public async deletePrompt(uri: vscode.Uri, line: number): Promise<boolean> {
        const initialLength = this.prompts.length;
        
        this.prompts = this.prompts.filter(p => 
            !(p.uri === uri.toString() && p.line === line)
        );
        
        if (this.prompts.length !== initialLength) {
            this.savePrompts();
            return true;
        }
        
        return false;
    }
    
    public async getAllPrompts(): Promise<PromptEntry[]> {
        return [...this.prompts];
    }
    
    public async getPromptsForFile(uri: vscode.Uri): Promise<PromptEntry[]> {
        return this.prompts.filter(p => p.uri === uri.toString());
    }
    
    public async getRelevantVariables(uri: vscode.Uri, line: number): Promise<string[]> {
        const prompt = this.prompts.find(p => 
            p.uri === uri.toString() && p.line === line
        );
        
        if (prompt?.enhancedDetails?.relevantVariables) {
            return prompt.enhancedDetails.relevantVariables;
        }
        
        return [];
    }
    
    public async getCheckConditions(uri: vscode.Uri, line: number): Promise<string[]> {
        const prompt = this.prompts.find(p => 
            p.uri === uri.toString() && p.line === line
        );
        
        if (prompt?.enhancedDetails?.checkConditions) {
            return prompt.enhancedDetails.checkConditions;
        }
        
        return [];
    }
}