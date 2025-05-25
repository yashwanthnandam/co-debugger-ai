import * as vscode from 'vscode';
import axios from 'axios';
import OpenAI from 'openai';
import { API_KEYS } from './config';


export interface LLMAnalysisResult {
    suggestions: string[];
    riskAreas: string[];
    codeUnderstanding: {
        complexFunctions: string[];
        potentialBugs: string[];
        dataFlowInsights: string[];
    };
}

export interface AnomalyExplanation {
    explanation: string;
    possibleCauses: string[];
    suggestedChecks: string[];
    confidence: number;
}

export interface RootCauseInsight {
    description: string;
    explanation: string;
    confidence: number;
    relatedCode: string[];
    potentialFixes: string[];
}

export interface FixSuggestion {
    description: string;
    code: string;
    impact: string;
    confidence: number;
}

export class LLMService {
    private provider: string;
    private apiKey: string;
    private model: string;
    private temperature: number;
    private localEndpoint: string;
    private projectContext: Map<string, string> = new Map();
    
    // Client instances
    private openaiClient: OpenAI | null = null;
    // private anthropicClient: Anthropic | null = null;
    
    constructor() {
        // Get configuration
        const config = vscode.workspace.getConfiguration('intelligentDebugger');
        this.provider = config.get<string>('llmProvider') || 'openai';
        this.model = config.get<string>('llmModel') || 'gpt-4';
        this.temperature = config.get<number>('temperature') || 0.7;
        this.localEndpoint = config.get<string>('localLLMEndpoint') || 'http://localhost:8080/v1';
        
        // Try to get API key from config
        this.apiKey = config.get<string>(`${this.provider}ApiKey`) || '';
        
        if (!this.apiKey) {
            console.log('No API key in settings, trying to use hardcoded config');
            
            switch (this.provider) {
                case 'openai':
                    this.apiKey = API_KEYS.OPENAI || '';
                    break;
                case 'anthropic':
                    this.apiKey = API_KEYS.ANTHROPIC || '';
                    break;
                case 'google':
                    this.apiKey = API_KEYS.GOOGLE || '';
                    break;
            }
        }
        
        // Initialize appropriate client if API key is available
        if (this.apiKey || this.provider === 'local') {
            this.initializeClient();
        } else {
            console.log('No API key found for provider:', this.provider);
        }
    }
    
    /**
     * Initialize the appropriate client based on provider
     */
    private initializeClient(): void {
        try {
            switch (this.provider) {
                case 'openai':
                    if (this.apiKey) {
                        this.openaiClient = new OpenAI({ apiKey: this.apiKey });
                        console.log('OpenAI client initialized');
                    }
                    break;
                    
                case 'anthropic':
                    if (this.apiKey) {
                        // this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
                        console.log('Anthropic client initialized');
                    }
                    break;
                    
                case 'google':
                    console.log('Google AI client initialization - API key available:', !!this.apiKey);
                    // Google client would be initialized here
                    break;
                    
                case 'local':
                    console.log('Local LLM endpoint configured:', this.localEndpoint);
                    // No client needed for local, we'll use axios directly
                    break;
                    
                default:
                    console.warn('Unknown provider:', this.provider);
            }
        } catch (error) {
            console.error('Error initializing LLM client:', error);
            void vscode.window.showErrorMessage(`Failed to initialize LLM client: ${error.message}`);
        }
    }

    /**
     * Update the service configuration
     */
    public async updateConfiguration(config: any): Promise<void> {
        // Store the config for use in this service
        this.provider = config.provider;
        this.model = config.model;
        this.temperature = config.temperature;
        this.apiKey = config.apiKey;
        
        console.log(`Updating LLM configuration: ${this.provider} / ${this.model}`);
        
        // Initialize the appropriate client based on provider
        switch (this.provider) {
            case 'openai':
                this.initializeOpenAI();
                break;
            case 'anthropic':
                this.initializeAnthropic();
                break;
            case 'google':
                this.initializeGoogle();
                break;
            case 'local':
                this.initializeLocal();
                break;
        }
        
        // Validate the configuration by making a simple API call
        try {
            await this.testConnection();
            // Configuration worked!
            const configInfo = `Connected to ${this.provider} using ${this.model}`;
            vscode.window.setStatusBarMessage(`${configInfo}`, 5000);
        } catch (error) {
            throw new Error(`Failed to connect to ${this.provider}: ${error.message}`);
        }
    }

    /**
     * Test the connection to the LLM provider
     */
    private async testConnection(): Promise<void> {
        try {
            const testResponse = await this.callLLM("Respond with 'Connection successful' if you can read this.");
            if (!testResponse.includes("Connection successful")) {
                throw new Error("Invalid response from LLM provider");
            }
        } catch (error) {
            console.error("Connection test failed:", error);
            throw error;
        }
    }
    
    /**
     * Initialize OpenAI client
     */
    private initializeOpenAI(): void {
        try {
            const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('OpenAI API key not found');
            }
            
            // Initialize OpenAI client
            this.openaiClient = new OpenAI({ apiKey });
            console.log('OpenAI client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize OpenAI client:', error);
            throw error;
        }
    }

    /**
     * Initialize Anthropic client
     */
    private initializeAnthropic(): void {
        try {
            const apiKey = this.apiKey || process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                throw new Error('Anthropic API key not found');
            }

            // Initialize Anthropic client
            // this.anthropicClient = new Anthropic({ apiKey });
            console.log('Anthropic client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Anthropic client:', error);
            throw error;
        }
    }

    /**
     * Initialize Google AI client
     */
    private initializeGoogle(): void {
        try {
            const apiKey = this.apiKey || process.env.GOOGLE_API_KEY;
            if (!apiKey) {
                throw new Error('Google API key not found');
            }

            // Placeholder for Google client initialization
            console.log('Google client initialized with API key (length):', apiKey.length);
        } catch (error) {
            console.error('Failed to initialize Google client:', error);
            throw error;
        }
    }
    
    /**
     * Initialize local LLM endpoint
     */
    private initializeLocal(): void {
        try {
            // Just verify the endpoint is set
            if (!this.localEndpoint) {
                this.localEndpoint = 'http://localhost:8080/v1';
                console.warn('Using default local LLM endpoint:', this.localEndpoint);
            } else {
                console.log('Local LLM endpoint set to:', this.localEndpoint);
            }
        } catch (error) {
            console.error('Failed to initialize local LLM endpoint:', error);
            throw error;
        }
    }
    
    /**
     * Call LLM with system prompt and user prompt
     */
    public async callLLM(prompt: string, systemPrompt?: string): Promise<string> {
        if (!this.apiKey && this.provider !== 'local') {
            throw new Error('LLM API key not configured. Please configure it in the settings.');
        }
        
        try {
            switch (this.provider) {
                case 'openai':
                    if (!this.openaiClient) {
                        throw new Error('OpenAI client not initialized');
                    }
                    
                    const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [];
                    
                    if (systemPrompt) {
                        messages.push({ 
                            role: 'system', 
                            content: systemPrompt 
                        });
                    }
                    
                    messages.push({ 
                        role: 'user', 
                        content: prompt 
                    });
                    
                    const openaiResponse = await this.openaiClient.chat.completions.create({
                        model: this.model,
                        messages: messages,
                        temperature: this.temperature
                    });
                    
                    return openaiResponse.choices[0]?.message?.content || '';
                    
                // case 'anthropic':
                //     if (!this.anthropicClient) {
                //         throw new Error('Anthropic client not initialized');
                //     }
                    
                //     // Updated Anthropic API call for Claude 3 models
                //     const anthropicResponse = await this.anthropicClient.messages.create({
                //         model: this.model,
                //         max_tokens: 4000,
                //         system: systemPrompt,
                //         messages: [{ role: 'user', content: prompt }],
                //         temperature: this.temperature
                //     });
                    
                //     return anthropicResponse.content[0]?.text || '';
                    
                case 'google':
                    // Example implementation for Google (adjust based on the actual SDK)
                    const googleEndpoint = "https://generativelanguage.googleapis.com/v1beta/models";
                    const googleResponse = await axios.post(
                        `${googleEndpoint}/${this.model}:generateContent?key=${this.apiKey}`,
                        {
                            contents: [
                                ...(systemPrompt ? [{ role: "system", parts: [{ text: systemPrompt }] }] : []),
                                { role: "user", parts: [{ text: prompt }] }
                            ],
                            generationConfig: {
                                temperature: this.temperature
                            }
                        }
                    );
                    
                    return googleResponse.data.candidates[0]?.content?.parts[0]?.text || '';
                    
                case 'local':
                    // Local LLM implementation (compatible with OpenAI-style API)
                    const response = await axios.post(`${this.localEndpoint}/chat/completions`, {
                        model: this.model,
                        messages: [
                            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                            { role: 'user', content: prompt }
                        ],
                        temperature: this.temperature
                    });
                    
                    return response.data.choices[0]?.message?.content || '';
                    
                default:
                    throw new Error(`Unsupported LLM provider: ${this.provider}`);
            }
        } catch (error) {
            console.error('Error calling LLM:', error);
            throw error;
        }
    }
    
    /**
     * Enhanced code analysis with LLM
     */
    public async analyzeCodeWithLLM(
        code: string, 
        filename: string, 
        projectContext?: string
    ): Promise<LLMAnalysisResult> {
        // Construct prompt for code analysis
        const systemPrompt = 
            "You are an expert code analyzer specialized in debugging and identifying potential issues. " +
            "Analyze the provided code deeply to identify complex areas, potential bugs, and data flow insights. " +
            "Focus on areas that might need debugging attention, such as complex control flows, error-prone patterns, " +
            "and potential edge cases. Be specific and concise in your analysis.";
        
        const prompt = `
# Code Analysis Request

## File: ${filename}

\`\`\`
${code}
\`\`\`

${projectContext ? `## Project Context:\n${projectContext}\n` : ''}

## Analysis Tasks:
1. Identify the most complex functions or code blocks that might benefit from targeted debugging
2. Detect potential bugs, edge cases, or error-prone patterns
3. Provide insights about data flow and variable transformations
4. Suggest optimal locations for placing breakpoints for effective debugging
5. Identify areas where state changes in unexpected ways

Format your response as a JSON object with these fields:
- suggestions: Array of debugging suggestions
- riskAreas: Array of areas with high risk of bugs
- codeUnderstanding: Object with arrays for complexFunctions, potentialBugs, and dataFlowInsights
`;

        try {
            const response = await this.callLLM(prompt, systemPrompt);
            
            // Parse JSON response
            try {
                return this.extractJsonFromMarkdown(response);
            } catch (e) {
                console.error('Failed to parse LLM response as JSON:', e);
                
                // Attempt to extract structured information from text
                return this.extractStructuredInfoFromText(response);
            }
        } catch (error) {
            console.error('Error analyzing code with LLM:', error);
            
            // Return default structure in case of error
            return {
                suggestions: ['Error connecting to LLM service'],
                riskAreas: [],
                codeUnderstanding: {
                    complexFunctions: [],
                    potentialBugs: [],
                    dataFlowInsights: []
                }
            };
        }
    }
    
    private extractStructuredInfoFromText(text: string): LLMAnalysisResult {
        // Fallback extraction of information from text when JSON parsing fails
        const result: LLMAnalysisResult = {
            suggestions: [],
            riskAreas: [],
            codeUnderstanding: {
                complexFunctions: [],
                potentialBugs: [],
                dataFlowInsights: []
            }
        };
        
        // Extract suggestions (lines starting with "Suggestion:" or bullets under "Suggestions")
        const suggestionMatches = text.match(/(?:Suggestion|Debugging Suggestion):\s*(.+?)(?:\n|$)/g);
        if (suggestionMatches) {
            for (const match of suggestionMatches) {
                const suggestion = match.replace(/(?:Suggestion|Debugging Suggestion):\s*/, '').trim();
                if (suggestion) result.suggestions.push(suggestion);
            }
        }
        
        // Extract risk areas
        const riskMatches = text.match(/(?:Risk Area|Potential Issue):\s*(.+?)(?:\n|$)/g);
        if (riskMatches) {
            for (const match of riskMatches) {
                const risk = match.replace(/(?:Risk Area|Potential Issue):\s*/, '').trim();
                if (risk) result.riskAreas.push(risk);
            }
        }
        
        // Similarly extract other sections
        // Complex functions
        const complexMatches = text.match(/(?:Complex Function|Complex Area):\s*(.+?)(?:\n|$)/g);
        if (complexMatches) {
            for (const match of complexMatches) {
                const complex = match.replace(/(?:Complex Function|Complex Area):\s*/, '').trim();
                if (complex) result.codeUnderstanding.complexFunctions.push(complex);
            }
        }
        
        return result;
    }
    
    /**
     * Generate insights for debugging session data
     */
    public async generateDebugInsight(
        fileName: string, 
        lineNumber: number, 
        codeSnippet: string, 
        variables: string,
        callStack: string[]
    ): Promise<{ 
        explanation: string, 
        keyVariables?: Array<{name: string, explanation: string}>,
        potentialIssues?: string[]
    }> {
        try {
            // Format call stack for the LLM
            const formattedCallStack = callStack?.length > 0 ? 
                callStack.slice(0, 3).join('\n') : 
                "No call stack available";
                
            // Create the LLM prompt
            const systemPrompt = 
                "You are an expert debugging assistant analyzing real-time debugging data. " +
                "Provide clear, concise explanations of code behavior at specific breakpoints. " +
                "Focus on the key variables, their meaning, and any potential issues.";
                
            const prompt = `
    You are analyzing a debugging session at ${fileName}:${lineNumber}.

    CODE:
    \`\`\`
    ${codeSnippet}
    \`\`\`

    VARIABLES AT BREAKPOINT:
    \`\`\`
    ${variables}
    \`\`\`

    CALL STACK:
    \`\`\`
    ${formattedCallStack}
    \`\`\`

    Provide a clear, concise explanation of what's happening at this breakpoint. Focus on:
    1. What the code is doing at this specific line
    2. The meaning and significance of key variables 
    3. Any potential issues or anomalies in the variables or code flow

    Output in this format:
    - A paragraph explaining what's happening in plain English
    - Up to 3 key variables with explanations of their meaning/significance
    - Any potential issues you detect (be specific)

    Keep your explanation helpful for a developer trying to understand their code's behavior.
    `;

            // Call the LLM using the existing method
            const response = await this.callLLM(prompt, systemPrompt);
            
            if (!response) {
                throw new Error("Failed to get response from LLM");
            }
            
            // Parse the response
            const insight = this.parseDebugInsight(response);
            return insight;
            
        } catch (error) {
            console.error('Error getting LLM insight:', error);
            return {
                explanation: "Unable to generate AI explanation. You can still view the raw variables below."
            };
        }
    }

    /**
     * Parse debug insight from LLM response
     */
    private parseDebugInsight(response: string): { 
        explanation: string, 
        keyVariables?: Array<{name: string, explanation: string}>,
        potentialIssues?: string[]
    } {
        try {
            // Default result with just the raw response in case parsing fails
            const defaultResult = {
                explanation: response
            };
            
            // Extract the main explanation (first paragraph)
            const mainExplanationMatch = response.match(/(.+?)(?=\n\n|$)/s);
            const mainExplanation = mainExplanationMatch ? mainExplanationMatch[0] : response;
            
            // Extract key variables section
            const keyVariables: Array<{name: string, explanation: string}> = [];
            const variableMatches = response.matchAll(/[•-]\s*(?:`|')?([a-zA-Z0-9_]+)(?:`|')?[\s:]+([^\n]+)/g);
            
            for (const match of variableMatches) {
                if (match[1] && match[2]) {
                    keyVariables.push({
                        name: match[1],
                        explanation: match[2].trim()
                    });
                }
            }
            
            // Extract potential issues
            const issues: string[] = [];
            // Look for a section that might start with "potential issues", "issues", etc.
            const issuesSectionMatch = response.match(/(?:potential issues|issues|problems|anomalies|concerns)(?:\s*detected)?(?:\s*:|:?\s*\n)([\s\S]+?)(?=\n\n|$)/i);
            
            if (issuesSectionMatch && issuesSectionMatch[1]) {
                const issuesText = issuesSectionMatch[1].trim();
                const issueSplit = issuesText.split(/\n[•-]\s*/);
                
                for (const issue of issueSplit) {
                    const trimmed = issue.trim();
                    if (trimmed && trimmed.length > 5) {
                        issues.push(trimmed);
                    }
                }
            }
            
            return {
                explanation: mainExplanation,
                keyVariables: keyVariables.length > 0 ? keyVariables : undefined,
                potentialIssues: issues.length > 0 ? issues : undefined
            };
            
        } catch (err) {
            console.error('Error parsing LLM insight:', err);
            return {
                explanation: response
            };
        }
    }
    /**
     * Generate explanation for anomalies during debugging
     */
    public async explainAnomaly(
        code: string,
        variableValues: Record<string, any>,
        anomalyDescription: string,
        executionContext?: string
    ): Promise<AnomalyExplanation> {
        const systemPrompt = 
            "You are an expert code analyzer specialized in debugging and identifying potential issues. " +
            "Analyze the provided code deeply to identify complex areas, potential bugs, and data flow insights. " +
            "Focus on areas that might need debugging attention, such as complex control flows, error-prone patterns, " +
            "and potential edge cases. Be specific and concise in your analysis. " +
            "Provide your response as raw JSON with no Markdown formatting or explanation text.";
        const prompt = `
# Anomaly Analysis Request

## Code Context:
\`\`\`
${code}
\`\`\`

## Current Variable Values:
\`\`\`json
${JSON.stringify(variableValues, null, 2)}
\`\`\`

## Anomaly Description:
${anomalyDescription}

${executionContext ? `## Execution Context:\n${executionContext}\n` : ''}

Please provide:
1. A clear explanation of what might be causing this anomaly
2. A list of possible root causes ordered by likelihood
3. Specific checks or tests that would help confirm the true cause
4. A confidence level (0-1) for your assessment

Format your response as a JSON object with these fields:
- explanation: String with your main explanation
- possibleCauses: Array of strings with potential causes
- suggestedChecks: Array of strings with specific checks to perform
- confidence: Number between 0-1 indicating confidence
`;

        try {
            const response = await this.callLLM(prompt, systemPrompt);
            
            // Parse JSON response
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error('Failed to parse LLM response as JSON:', e);
                
                // Fallback to a structured response
                return {
                    explanation: response.split('\n\n')[0] || "Failed to parse explanation",
                    possibleCauses: this.extractListItems(response, "Possible Causes:", "Suggested Checks:"),
                    suggestedChecks: this.extractListItems(response, "Suggested Checks:", "Confidence:"),
                    confidence: this.extractConfidence(response) || 0.5
                };
            }
        } catch (error) {
            console.error('Error explaining anomaly with LLM:', error);
            
            return {
                explanation: "Error connecting to LLM service",
                possibleCauses: [],
                suggestedChecks: [],
                confidence: 0
            };
        }
    }
    
    /**
     * Analyze patterns to identify root causes
     */
    public async analyzeRootCause(
        anomalyData: any,
        relevantCode: string,
        executionHistory: any[]
    ): Promise<RootCauseInsight> {
        const systemPrompt = 
            "You are an expert root cause analysis system, specialized in debugging software issues. " +
            "Your task is to analyze patterns, execution history, and code to determine the most likely " +
            "root cause of observed anomalies. Provide detailed explanations and suggest potential fixes.";
        
        const prompt = `
# Root Cause Analysis Request

## Anomaly Data:
\`\`\`json
${JSON.stringify(anomalyData, null, 2)}
\`\`\`

## Relevant Code:
\`\`\`
${relevantCode}
\`\`\`

## Execution History Summary:
\`\`\`json
${JSON.stringify(executionHistory, null, 2)}
\`\`\`

Analyze the provided information to:
1. Identify the most likely root cause of the observed anomalies
2. Explain why this is likely the root cause (the reasoning)
3. Identify specific lines or patterns in the code related to the root cause
4. Suggest potential fixes with code examples

Format your response as a JSON object with these fields:
- description: A concise description of the root cause
- explanation: A detailed explanation of why this is the root cause
- confidence: A number between 0-1 indicating your confidence level
- relatedCode: Array of strings identifying specific code areas
- potentialFixes: Array of strings with suggested fixes
`;

        try {
            const response = await this.callLLM(prompt, systemPrompt);
            
            // Parse JSON response
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error('Failed to parse LLM response as JSON:', e);
                
                // Fallback to structured extraction
                return {
                    description: this.extractSection(response, "Root Cause:", "Explanation:") || "Unknown root cause",
                    explanation: this.extractSection(response, "Explanation:", "Related Code:") || response,
                    confidence: this.extractConfidence(response) || 0.5,
                    relatedCode: this.extractListItems(response, "Related Code:", "Potential Fixes:"),
                    potentialFixes: this.extractListItems(response, "Potential Fixes:", null)
                };
            }
        } catch (error) {
            console.error('Error analyzing root cause with LLM:', error);
            
            return {
                description: "Error connecting to LLM service",
                explanation: "Failed to analyze root cause due to service connection issues",
                confidence: 0,
                relatedCode: [],
                potentialFixes: []
            };
        }
    }
    
    /**
     * Understand semantic meaning of debug prompts
     */
    public async enhanceDebugPrompt(
        userPrompt: string,
        codeContext: string,
        currentState: Record<string, any>
    ): Promise<{
        enhancedPrompt: string;
        relevantVariables: string[];
        expectedBehavior: string;
        checkConditions: string[];
    }> {
        const systemPrompt = 
            "You are an expert debugging assistant that helps enhance user debug prompts with deeper semantic understanding. " +
            "Your task is to take a user's debugging question, relevant code context, and current state to produce " +
            "an enhanced version that identifies key variables to inspect and specific conditions to check.";
        
        const prompt = `
# Debug Prompt Enhancement Request

## User's Debug Prompt:
"${userPrompt}"

## Code Context:
\`\`\`
${codeContext}
\`\`\`

## Current Program State:
\`\`\`json
${JSON.stringify(currentState, null, 2)}
\`\`\`

Please analyze the user's debug prompt and enhance it by:
1. Rephrasing it for clarity while preserving the original intent
2. Identifying the most relevant variables that should be inspected
3. Describing the expected behavior that should be observed
4. Specifying conditions that should be checked to diagnose the issue

Format your response as a JSON object with these fields:
- enhancedPrompt: A clearer version of the user's prompt
- relevantVariables: Array of variable names that are most important to inspect
- expectedBehavior: Clear description of what correct behavior would look like
- checkConditions: Array of specific conditions to verify
`;

        try {
            const response = await this.callLLM(prompt, systemPrompt);
            
            // Parse JSON response
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error('Failed to parse LLM response as JSON:', e);
                
                // Extract structured information when JSON parsing fails
                return {
                    enhancedPrompt: this.extractSection(response, "Enhanced Prompt:", "Relevant Variables:") || userPrompt,
                    relevantVariables: this.extractListItems(response, "Relevant Variables:", "Expected Behavior:"),
                    expectedBehavior: this.extractSection(response, "Expected Behavior:", "Check Conditions:") || "",
                    checkConditions: this.extractListItems(response, "Check Conditions:", null)
                };
            }
        } catch (error) {
            console.error('Error enhancing debug prompt with LLM:', error);
            
            return {
                enhancedPrompt: userPrompt,
                relevantVariables: [],
                expectedBehavior: "",
                checkConditions: []
            };
        }
    }
    
    
    /**
     * Generate fix suggestions for identified issues
     */
    public async suggestFixes(
        rootCause: string,
        relevantCode: string,
        executionContext: string
    ): Promise<FixSuggestion[]> {
        const systemPrompt = 
            "You are an expert code repair system. Your task is to analyze identified root causes of bugs " +
            "and suggest specific fixes with actual code. Provide a range of possible fixes from simple patches " +
            "to more comprehensive solutions, with clear explanations of the impact of each fix.";
        
        const prompt = `
# Fix Suggestion Request

## Root Cause:
${rootCause}

## Relevant Code:
\`\`\`
${relevantCode}
\`\`\`

## Execution Context:
${executionContext}

Please suggest 2-4 potential fixes for this issue:
1. From simple, targeted patches to more comprehensive solutions
2. Include actual code, not just descriptions
3. Explain the impact and trade-offs of each fix
4. Indicate your confidence in each suggestion

Format your response as a JSON array of fix objects, each with these fields:
- description: A clear description of what the fix does
- code: The actual code of the fix
- impact: Description of the fix's impact and any trade-offs
- confidence: Number between 0-1 indicating confidence
`;

        try {
            const response = await this.callLLM(prompt, systemPrompt);
            
            // Parse JSON response
            try {
                return JSON.parse(response);
            } catch (e) {
                console.error('Failed to parse LLM response as JSON:', e);
                
                // Return a simple structured response
                return [{
                    description: "Failed to parse detailed fixes",
                    code: this.extractCodeBlocks(response)[0] || "// No code available",
                    impact: "Unknown impact due to parsing error",
                    confidence: 0.5
                }];
            }
        } catch (error) {
            console.error('Error generating fix suggestions with LLM:', error);
            
            return [{
                description: "Error connecting to LLM service",
                code: "// Unable to generate fix suggestions",
                impact: "None - service unavailable",
                confidence: 0
            }];
        }
    }
    
    public async setProjectContext(contextFiles: Map<string, string>): Promise<void> {
        this.projectContext = new Map(contextFiles);
        console.log(`Project context set with ${contextFiles.size} files`);
    }
    
    /**
     * Extract JSON from a potentially Markdown-formatted LLM response
     */
    private extractJsonFromMarkdown(text: string): any {
        // Check if the response is wrapped in a Markdown code block
        const jsonRegex = /```(?:json)?\s*([\s\S]*?)```/;
        const match = text.match(jsonRegex);
        
        if (match && match[1]) {
            try {
                // Parse the content inside the code block
                return JSON.parse(match[1].trim());
            } catch (e) {
                console.error('Failed to parse JSON from Markdown code block:', e);
            }
        }
        
        // If no code block or parse fails, try parsing the entire text
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse entire response as JSON:', e);
            // Fall back to structured extraction
            return this.extractStructuredInfoFromText(text);
        }
    }
    
    /**
     * Helper methods for text extraction
     */
    private extractListItems(text: string, startMarker: string | null, endMarker: string | null): string[] {
        if (!startMarker) return [];
        
        const startIdx = text.indexOf(startMarker);
        if (startIdx === -1) return [];
        
        let endIdx = text.length;
        if (endMarker) {
            const tempEndIdx = text.indexOf(endMarker, startIdx + startMarker.length);
            if (tempEndIdx !== -1) endIdx = tempEndIdx;
        }
        
        const section = text.substring(startIdx + startMarker.length, endIdx).trim();
        
        // Extract list items (lines starting with - or * or numbers)
        const listItems: string[] = [];
        const lines = section.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.match(/^[-*]|^\d+\.\s/)) {
                // Remove the bullet or number and trim
                const item = trimmed.replace(/^[-*]|^\d+\.\s/, '').trim();
                if (item) listItems.push(item);
            }
        }
        
        return listItems;
    }
    
    private extractSection(text: string, startMarker: string | null, endMarker: string | null): string | null {
        if (!startMarker) return null;
        
        const startIdx = text.indexOf(startMarker);
        if (startIdx === -1) return null;
        
        let endIdx = text.length;
        if (endMarker) {
            const tempEndIdx = text.indexOf(endMarker, startIdx + startMarker.length);
            if (tempEndIdx !== -1) endIdx = tempEndIdx;
        }
        
        return text.substring(startIdx + startMarker.length, endIdx).trim();
    }
    
    private extractConfidence(text: string): number | null {
        const confidenceMatch = text.match(/Confidence:?\s*(0\.\d+|1\.0|1)/i);
        if (confidenceMatch && confidenceMatch[1]) {
            return parseFloat(confidenceMatch[1]);
        }
        return null;
    }
    
    private extractCodeBlocks(text: string): string[] {
        const codeBlocks: string[] = [];
        const regex = /```(?:[\w-]+)?\s*([\s\S]*?)```/g;
        
        let match;
        while ((match = regex.exec(text)) !== null) {
            if (match[1]) codeBlocks.push(match[1].trim());
        }
        
        return codeBlocks;
    }
}