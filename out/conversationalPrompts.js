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
exports.ConversationalPrompts = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const llmService_1 = require("./llmService");
class ConversationalPrompts {
    constructor(context, llmService) {
        this.prompts = [];
        this.llmService = llmService || new llmService_1.LLMService();
        if (context) {
            this.storageUri = context.globalStorageUri;
            this.loadPrompts();
        }
    }
    getStoragePath() {
        if (!this.storageUri)
            return undefined;
        const storagePath = path.join(this.storageUri.fsPath, 'prompts.json');
        // Ensure the directory exists
        const storageDir = path.dirname(storagePath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        return storagePath;
    }
    loadPrompts() {
        const storagePath = this.getStoragePath();
        if (!storagePath || !fs.existsSync(storagePath))
            return;
        try {
            const data = fs.readFileSync(storagePath, 'utf8');
            this.prompts = JSON.parse(data);
        }
        catch (error) {
            console.error('Error loading prompts:', error);
            this.prompts = [];
        }
    }
    savePrompts() {
        const storagePath = this.getStoragePath();
        if (!storagePath)
            return;
        try {
            fs.writeFileSync(storagePath, JSON.stringify(this.prompts, null, 2), 'utf8');
        }
        catch (error) {
            console.error('Error saving prompts:', error);
        }
    }
    async setPrompt(uri, line, text, expectedValue) {
        // Use LLM to enhance the prompt with semantic understanding
        const enhancedDetails = await this.enhancePromptWithLLM(uri, line, text, expectedValue);
        // Check if a prompt already exists for this location
        const existingIndex = this.prompts.findIndex(p => p.uri === uri.toString() && p.line === line);
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
        }
        else {
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
    async enhancePromptWithLLM(uri, line, text, expectedValue) {
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
            const currentState = {};
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
            return await this.llmService.enhanceDebugPrompt(text, codeContext, currentState);
        }
        catch (error) {
            console.error('Error enhancing prompt with LLM:', error);
            return undefined;
        }
    }
    async getPrompt(uri, line) {
        var _a;
        const prompt = this.prompts.find(p => p.uri === uri.toString() && p.line === line);
        if (prompt) {
            return {
                text: ((_a = prompt.enhancedDetails) === null || _a === void 0 ? void 0 : _a.enhancedPrompt) || prompt.text,
                expectedValue: prompt.expectedValue,
                enhancedDetails: prompt.enhancedDetails
            };
        }
        return undefined;
    }
    async deletePrompt(uri, line) {
        const initialLength = this.prompts.length;
        this.prompts = this.prompts.filter(p => !(p.uri === uri.toString() && p.line === line));
        if (this.prompts.length !== initialLength) {
            this.savePrompts();
            return true;
        }
        return false;
    }
    async getAllPrompts() {
        return [...this.prompts];
    }
    async getPromptsForFile(uri) {
        return this.prompts.filter(p => p.uri === uri.toString());
    }
    async getRelevantVariables(uri, line) {
        var _a;
        const prompt = this.prompts.find(p => p.uri === uri.toString() && p.line === line);
        if ((_a = prompt === null || prompt === void 0 ? void 0 : prompt.enhancedDetails) === null || _a === void 0 ? void 0 : _a.relevantVariables) {
            return prompt.enhancedDetails.relevantVariables;
        }
        return [];
    }
    async getCheckConditions(uri, line) {
        var _a;
        const prompt = this.prompts.find(p => p.uri === uri.toString() && p.line === line);
        if ((_a = prompt === null || prompt === void 0 ? void 0 : prompt.enhancedDetails) === null || _a === void 0 ? void 0 : _a.checkConditions) {
            return prompt.enhancedDetails.checkConditions;
        }
        return [];
    }
}
exports.ConversationalPrompts = ConversationalPrompts;
//# sourceMappingURL=conversationalPrompts.js.map