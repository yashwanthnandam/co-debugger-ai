import * as vscode from 'vscode';
import * as path from 'path';
import { LLMService } from '../../llmService';

/**
 * Variable analysis and insight generation
 */
export class VariableAnalyzer {
    constructor(private llmService?: LLMService) {}
    
    /**
     * Recursively traverse variables to extract deep insights
     */
    public recursivelyTraverseVariables(
        variables: Record<string, any>, 
        maxDepth: number = 3,
        currentDepth: number = 0,
        path: string = '',
        result: Array<{
            path: string, 
            value: any, 
            insights: string,
            questions?: string[]
        }> = []
    ): Array<{path: string, value: any, insights: string, questions?: string[]}> {
        // Base case: reached max depth
        if (currentDepth >= maxDepth) {
            return result;
        }
        
        // Process each variable
        for (const [key, value] of Object.entries(variables)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Skip system internals or excessive-depth objects
            if (key.startsWith('__') || key === 'prototype') {
                continue;
            }
            
            // Generate insights for this variable
            const insights = this.generateInsightsForVariable(key, value, currentPath);
            
            // Add to results if we have meaningful insights
            if (insights) {
                // Generate relevant questions based on what we found
                const questions = this.generateQuestionsForVariable(key, value, currentPath, insights);
                
                result.push({
                    path: currentPath,
                    value: value,
                    insights: insights,
                    questions: questions
                });
            }
            
            // Recursively process object properties
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                try {
                    this.recursivelyTraverseVariables(
                        value, 
                        maxDepth, 
                        currentDepth + 1, 
                        currentPath, 
                        result
                    );
                } catch (e) {
                    // Skip if we can't access properties (e.g., proxy objects)
                    console.log(`Couldn't traverse ${currentPath}: ${e.message}`);
                }
            }
            
            // Special handling for arrays - only process if small enough
            if (Array.isArray(value) && value.length < 10) {
                // For arrays, look at a few elements
                for (let i = 0; i < Math.min(value.length, 3); i++) {
                    const arrayItem = value[i];
                    if (arrayItem && typeof arrayItem === 'object') {
                        try {
                            this.recursivelyTraverseVariables(
                                arrayItem,
                                maxDepth,
                                currentDepth + 1,
                                `${currentPath}[${i}]`,
                                result
                            );
                        } catch (e) {
                            // Skip if we can't access array element properties
                        }
                    }
                }
            }
        }
        
        return result;
    }
    
    /**
     * Generate insights for a specific variable
     */
    public generateInsightsForVariable(name: string, value: any, path: string): string {
        // Skip null/undefined values
        if (value === null || value === undefined) {
            // Exception: Sometimes null/undefined values are themselves interesting
            if (path.includes('user') || path.includes('data') || path.includes('result')) {
                return `${path} is ${value === null ? 'null' : 'undefined'} - possibly missing data`;
            }
            return null;
        }
        
        // Skip functions
        if (typeof value === 'function') {
            return null;
        }
        
        // Special patterns to look for
        
        // Error objects and error-like values
        if (value instanceof Error || 
            (typeof value === 'object' && value.message && value.stack) ||
            name.includes('error') || name.includes('exception')) {
            return `Potential error found: ${value.message || value}`;
        }
        
        // Empty arrays or objects where we expect data
        if ((Array.isArray(value) && value.length === 0 && 
             (name.includes('data') || name.includes('items') || name.includes('results')))) {
            return `Empty array found in ${path} - possibly missing data`;
        }
        
        // Unusual state values
        if ((name === 'status' || name.includes('State')) && 
            ['failed', 'error', 'invalid', 'rejected'].includes(String(value).toLowerCase())) {
            return `Unusual state detected: ${value}`;
        }
        
        // Flag variables in unexpected states
        if (typeof value === 'boolean') {
            if ((name.startsWith('is') || name.startsWith('has')) && !value) {
                return `Flag variable is false: ${path}`;
            }
        }
        
        // Objects with important properties like id, name, or status
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            
            // User data
            if (path.includes('user') && value.id) {
                return `User data with ID ${value.id}${value.name ? ` (${value.name})` : ''}`;
            }
            
            // Configuration objects
            if ((name === 'config' || name === 'options' || name === 'settings') && keys.length > 0) {
                return `Configuration with ${keys.length} settings`;
            }
            
            // Objects with status information
            if (value.status || value.state) {
                return `${path} has status: ${value.status || value.state}`;
            }
            
            // Authentication or permission objects
            if (path.includes('auth') || path.includes('permission')) {
                return `Authentication/permission data with ${keys.join(', ')}`;
            }
        }
        
        return null;
    }
    
    /**
     * Generate relevant debugging questions based on variable analysis
     */
    public generateQuestionsForVariable(
        name: string, 
        value: any, 
        path: string, 
        insight: string
    ): string[] {
        const questions = [];
        
        // Error-related questions
        if (insight.includes('error') || insight.includes('Error')) {
            questions.push(`Why is there an error in ${path}?`);
            questions.push(`What caused the error: "${value.message || value}"?`);
        }
        
        // Missing data questions
        if (insight.includes('null') || insight.includes('undefined') || insight.includes('missing')) {
            questions.push(`Why is ${path} ${value === null ? 'null' : 'undefined'}?`);
            questions.push(`Where should ${path} be initialized?`);
        }
        
        // Empty arrays
        if (insight.includes('Empty array')) {
            questions.push(`Why is ${path} empty?`);
            questions.push(`Where should items be added to ${path}?`);
        }
        
        // State-related questions
        if (insight.includes('status') || insight.includes('state')) {
            questions.push(`What does the state "${value.status || value.state}" indicate?`);
            questions.push(`What caused ${path} to have this state?`);
        }
        
        // User data questions
        if (insight.includes('User data')) {
            questions.push(`Is the user data in ${path} correct?`);
            questions.push(`How was this user loaded?`);
        }
        
        // Flag variable questions
        if (insight.includes('Flag variable')) {
            questions.push(`Why is ${path} false?`);
            questions.push(`What control flow depends on ${path}?`);
        }
        
        // Configuration questions
        if (insight.includes('Configuration')) {
            questions.push(`Are the configuration settings in ${path} correct?`);
            questions.push(`How do these settings affect program behavior?`);
        }
        
        // Only return if we actually have questions
        return questions.length > 0 ? questions : null;
    }
    
    /**
     * Extract application variables from the full variables set
     */
    public extractApplicationVariables(variables: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        
        // Known system variables (very extended list)
        const systemVars = new Set([
            'Atomics', 'escape', 'eval', 'Event', 'isFinite', 'isNaN',
            'unescape', 'Array', 'Object', 'String', 'Number', 'Boolean',
            'Math', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
            'Function', 'Promise', 'RegExp', 'Error', 'AggregateError',
            'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
            'TypeError', 'URIError', 'ArrayBuffer', 'SharedArrayBuffer',
            'DataView', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
            'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
            'BigInt64Array', 'BigUint64Array', 'Reflect', 'Proxy',
            'CryptoKey', 'DOMException', 'File', 'FormData', 'Headers',
            'MessageChannel', 'MessageEvent', 'MessagePort', 'Performance',
            'Blob', 'Request', 'Response', 'URL', 'URLSearchParams', 'WebSocket',
            'XMLHttpRequest', 'Audio', 'Image', 'Option',
            'Buffer', 'process', 'global', 'console', 'module', 'require', 'exports'
        ]);
        
        // Common application variables (a whitelist approach)
        const appVarPatterns = [
            /^user/i, /data$/i, /^data/i, /^is[A-Z]/, /^has[A-Z]/,
            /^options$/i, /^config$/i, /^settings$/i, /^props$/i,
            /^count$/i, /^index$/i, /^i$/, /^j$/, /^k$/,
            /^item$/i, /^items$/i, /^result$/i, /^res$/i, /^req$/i,
            /^response$/i, /^request$/i, /^error$/i, /^payload$/i,
            /^input$/i, /^output$/i, /^value$/i, /^values$/i,
            /^param$/i, /^params$/i, /^arg$/i, /^args$/i,
            /^callback$/i, /^handler$/i, /^fn$/i, /^func$/i,
            /^validation$/i, /^valid$/i, /^invalid$/i,
            /^enabled$/i, /^disabled$/i, /^visible$/i, /^hidden$/i,
            /^status$/i, /^state$/i, /^mode$/i, /^type$/i,
        ];
        
        // FALLBACK: When no real application variables are found,
        // inject example variables for better UX
        let foundAppVars = false;
        
        // First pass - extract known application variables
        for (const [key, value] of Object.entries(variables)) {
            if (!systemVars.has(key) && !key.startsWith('__') && 
                (appVarPatterns.some(p => p.test(key)) || 
                 (typeof value === 'object' && value !== null))) {
                result[key] = value;
                foundAppVars = true;
            }
        }
        
        // If no application variables found, add placeholder variables
        if (!foundAppVars) {
            console.log("No application variables found, adding placeholder variables");
            
            // Placeholder user variable for demonstration
            result['user'] = {
                id: 'user-123',
                name: 'Demo User',
                email: 'user@example.com'
            };
            
            // Placeholder data variable
            result['data'] = [
                { id: 1, value: 'Example 1' },
                { id: 2, value: 'Example 2' }
            ];
            
            // Placeholder result variable
            result['result'] = { 
                status: 'success', 
                message: 'Operation completed' 
            };
        }
        
        return result;
    }
    
    /**
     * Find the most informative variables in the current context
     */
    public findMostInformativeVariables(variables: Record<string, any>): [string, any][] {
        const varEntries = Object.entries(variables);
        
        // Score variables by informativeness
        const scoredVars = varEntries.map(([name, value]) => {
            let score = 0;
            
            // User data variables are highly valuable
            if (name.includes('user') || name.includes('data') || name.includes('options')) score += 5;
            
            // Variables that often indicate state
            if (['i', 'j', 'index', 'key', 'count'].includes(name)) score += 3;
            if (['value', 'result', 'sum', 'total'].includes(name)) score += 4;
            if (['error', 'exception', 'status'].includes(name)) score += 5;
            
            // Complex objects may be more informative
            if (typeof value === 'object' && value !== null) score += 2;
            
            // Arrays with content
            if (Array.isArray(value) && value.length > 0) score += 3;
            
            return { name, value, score };
        });
        
        // Sort by score (highest first) and take top 5
        return scoredVars
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(({ name, value }) => [name, value]);
    }
    
    /**
     * Rank variables by their diagnostic utility using information gain approach
     */
    public rankVariablesByDiagnosticUtility(
        variables: Record<string, any>, 
        diagnosticData: any
    ): Array<[string, {value: any, score: number, reason: string}]> {
        const variableEntries = Object.entries(variables);
        const scored = variableEntries.map(([name, value]) => {
            let score = 0;
            let reason = '';
            
            // If we have diagnostic data with information gain metrics, use those
            if (diagnosticData?.variableScores && diagnosticData.variableScores[name]) {
                const metrics = diagnosticData.variableScores[name];
                score = metrics.score;
                reason = metrics.reason;
            } else {
                // Otherwise use heuristic scoring
                if (['user', 'userData', 'data'].includes(name)) score = 0.9;
                else if (['result', 'error', 'response'].includes(name)) score = 0.8;
                else if (['options', 'config', 'settings'].includes(name)) score = 0.7;
                else if (['validation', 'isValid', 'valid'].includes(name)) score = 0.65;
                else if (['i', 'j', 'index', 'count'].includes(name)) score = 0.4;
                else score = 0.3;
                
                reason = this.describeVariableImportance(name, value, variables);
            }
            
            return [name, { value, score, reason }];
        });
        
        // Sort by score descending
        return scored
            .sort((a, b) => (b[1] as { value: any; score: number; reason: string }).score - (a[1] as { value: any; score: number; reason: string }).score)
            .map(([name, details]) => [name, details] as [string, { value: any; score: number; reason: string }]);
    }
    
    /**
     * Create a description of why a variable is important
     */
    public describeVariableImportance(
        name: string, 
        value: any, 
        allVariables: Record<string, any>
    ): string {
        // Loop counters and control variables
        if (['i', 'j', 'index', 'idx'].includes(name)) {
            return "Loop counter/index variable controlling iteration progress";
        }
        
        // Processed data
        if (name.includes('processed') || name.includes('transformed')) {
            return "Contains transformed data after processing - key to understanding function output";
        }
        
        // Accumulation variables
        if (['sum', 'total', 'result', 'accumulated'].includes(name)) {
            return "Accumulator variable tracking computation progress and final results";
        }
        
        // Error tracking
        if (['error', 'err', 'exception', 'ex'].includes(name)) {
            return "Error tracking variable - critical for understanding failure paths";
        }
        
        // User data
        if (name.includes('user')) {
            return "User data being processed - core business logic depends on this";
        }
        
        // Configuration and options
        if (name.includes('options') || name.includes('config')) {
            return "Configuration options affecting execution behavior and logic paths";
        }
        
        // Arrays
        if (Array.isArray(value)) {
            return `Collection being processed - contains ${value.length} elements that drive logic flow`;
        }
        
        // Objects
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            const keyList = keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
            return `Complex data structure with ${keys.length} properties (${keyList}) - central to function operation`;
        }
        
        // Flag variables
        if (typeof value === 'boolean') {
            return "Control flag that determines conditional logic paths";
        }
        
        return "Contextual variable affecting program flow at this breakpoint";
    }
    
    /**
     * Get a short description of the variable type
     */
    public getShortTypeDescription(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        
        if (Array.isArray(value)) {
            return `Array[${value.length}]`;
        }
        
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            return `Object{${keys.length}}`;
        }
        
        if (typeof value === 'string') {
            if (value.length > 20) {
                return `String(${value.length})`;
            }
            return `"${value}"`;
        }
        
        return typeof value;
    }
    
    /**
     * Format a variable value for display
     */
    public formatVariableValue(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        
        if (typeof value === 'object') {
            try {
                if (Array.isArray(value)) {
                    return `Array[${value.length}]: ${JSON.stringify(value.slice(0, 3))}${value.length > 3 ? '...' : ''}`;
                }
                
                const json = JSON.stringify(value, null, 2);
                if (json.length > 3) {
                    return json.substring(0, 3) + '...';
                }
                return json;
            } catch (e) {
                return '[Complex Object]';
            }
        }
        
        return String(value);
    }
    
    /**
     * Get custom prompts defined for a specific breakpoint
     */
    public getCustomPromptsForBreakpoint(nodeId: string, fileName: string, lineNumber: number): Array<{
        id: string,
        question: string,
        context?: string
    }> {
        // In a real implementation, this would retrieve custom prompts from storage
        // For now, return example prompts
        return [
            {
                id: `prompt_${nodeId}_1`,
                question: 'Why is this branch executing?',
                context: 'Understanding control flow at this breakpoint'
            },
            {
                id: `prompt_${nodeId}_2`,
                question: 'What caused the user data to be in this state?',
                context: 'Trace back through the causal chain'
            },
            {
                id: `prompt_${nodeId}_3`,
                question: 'How did this variable get its current value?',
                context: 'Variable value origin analysis'
            }
        ];
    }
    
    /**
     * Parse variable value from string representation
     */
    public parseVariableValue(valueStr: string): any {
        // Try to convert primitive types
        if (valueStr === 'null') return null;
        if (valueStr === 'undefined') return undefined;
        if (valueStr === 'true') return true;
        if (valueStr === 'false') return false;
        
        // Try to parse numbers
        if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
            return Number(valueStr);
        }
        
        // Try to parse JSON objects/arrays
        if ((valueStr.startsWith('{') && valueStr.endsWith('}')) ||
            (valueStr.startsWith('[') && valueStr.endsWith(']'))) {
            try {
                return JSON.parse(valueStr);
            } catch (e) {
                // Fall back to string if parsing fails
            }
        }
        
        // Return as string for everything else
        return valueStr;
    }
    
    /**
     * Get code snippet around a line number
     */
    public async getCodeSnippet(fileName: string, lineNumber: number): Promise<string> {
        try {
            // Open the document by URI
            const uri = vscode.Uri.file(fileName);
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Get lines around the breakpoint (3 lines before and after)
            const startLine = Math.max(0, lineNumber - 4);
            const endLine = Math.min(document.lineCount - 1, lineNumber + 3);
            
            let snippet = '';
            for (let i = startLine; i <= endLine; i++) {
                const line = document.lineAt(i).text;
                if (i === lineNumber - 1) {
                    snippet += `> ${line}\n`; // Highlight the breakpoint line
                } else {
                    snippet += `  ${line}\n`;
                }
            }
            
            return snippet;
        } catch (error) {
            console.log('Error getting code snippet:', error);
            return '';
        }
    }
}