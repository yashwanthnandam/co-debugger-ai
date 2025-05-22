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
exports.CodeAnalyzer = void 0;
const vscode = __importStar(require("vscode"));
const llmService_1 = require("./llmService");
class CodeAnalyzer {
    constructor(llmService) {
        this.nodes = new Map();
        this.edges = [];
        this.currentFile = '';
        this.lastAnalysisResult = null;
        this.historicalErrorData = new Map(); // Simulated historical error data
        this.llmAnalysisResult = null;
        this.codeSnippets = new Map(); // Store code snippets for nodes
        // Initialize with some example historical error data
        this.loadHistoricalErrorData();
        this.llmService = llmService || new llmService_1.LLMService();
    }
    loadHistoricalErrorData() {
        // Simulate loading error frequency data from storage
        // Format: "filename:line" -> count of errors
        this.historicalErrorData = new Map([
            ["example.js:23", 5],
            ["example.js:45", 2],
            // More data would be loaded from storage in a real implementation
        ]);
    }
    // Add this method to your CodeAnalyzer class
    getLastAnalysisResult() {
        return this.lastAnalysisResult;
    }
    getLLMAnalysisResult() {
        return this.llmAnalysisResult;
    }
    async analyzeCode(code, filename) {
        this.currentFile = filename;
        this.nodes.clear();
        this.edges = [];
        this.codeSnippets.clear();
        const hasSyntaxIssues = this.hasSyntaxErrors(code);
        // if (hasSyntaxIssues) {
        //     console.log(`Skipping full analysis of ${filename} due to potential syntax errors`);
        //     // Create a single node for the file to indicate it exists but has errors
        //     const id = 'node_error_0';
        //     this.nodes.set(id, {
        //         id,
        //         type: 'File',
        //         location: {
        //             file: filename,
        //             line: 1,
        //             column: 0
        //         },
        //         complexity: 0,
        //         variables: [],
        //         incoming: [],
        //         outgoing: [],
        //         metadata: {
        //             isCritical: false,
        //             isLoop: false,
        //             isBranch: false,
        //             isErrorHandling: false,
        //             impactFactor: 0,
        //             historicalErrors: 0,
        //             llmRiskScore: 3, // Mark as high risk since we have syntax errors
        //             potentialBugs: ['File contains syntax errors that need to be fixed before analysis'],
        //             suggestedBreakpoints: false
        //         }
        //     });
        //      // Still get LLM analysis which might work even with some syntax errors
        //     try {
        //         await this.performLLMAnalysis(code, filename);
        //     } catch (llmError) {
        //         console.error('Error during LLM analysis of file with syntax errors:', llmError);
        //     }
        //     return;
        // }
        try {
            // First, get LLM insights about the code
            await this.performLLMAnalysis(code, filename);
            // Parse using a more compatible approach
            let ast;
            let isEsprimaAst = true;
            try {
                // Try standard esprima first - most compatible with estraverse
                const esprima = require('esprima');
                ast = esprima.parseScript(code, {
                    loc: true,
                    range: true,
                    tolerant: true
                });
                console.log("Parsed with Esprima");
            }
            catch (esprimaError) {
                console.log("Esprima parsing failed, trying preprocessing", esprimaError.message);
                try {
                    // Try with preprocessing
                    const processedCode = this.preprocessCodeForParser(code);
                    const esprima = require('esprima');
                    ast = esprima.parseScript(processedCode, {
                        loc: true,
                        range: true,
                        tolerant: true
                    });
                    console.log("Parsed with Esprima + preprocessing");
                }
                catch (preprocessError) {
                    console.log("Preprocessed Esprima failed, trying Acorn", preprocessError.message);
                    try {
                        // Try Acorn as a fallback - need to convert to esprima format
                        const acorn = require('acorn');
                        const rawAst = acorn.parse(code, {
                            ecmaVersion: 2022,
                            sourceType: 'module',
                            locations: true,
                            ranges: true
                        });
                        // Convert acorn AST to esprima-compatible format
                        ast = this.convertAcornToEsprima(rawAst);
                        console.log("Parsed with Acorn");
                    }
                    catch (acornError) {
                        console.log("Acorn failed, using Babel with custom traversal", acornError.message);
                        // Use Babel as last resort
                        const parser = require('@babel/parser');
                        ast = parser.parse(code, {
                            sourceType: 'module',
                            plugins: [
                                'jsx',
                                'typescript',
                                'objectRestSpread',
                                'optionalChaining',
                                'nullishCoalescingOperator'
                            ],
                            locations: true,
                            ranges: true
                        });
                        // We'll use custom traversal for Babel AST
                        isEsprimaAst = false;
                        console.log("Parsed with Babel - using custom traversal");
                    }
                }
            }
            // Select nodes directly from the AST (no traversal)
            if (isEsprimaAst) {
                // First pass: identify and create all nodes using estraverse
                this.identifyNodesWithEstraverse(ast, filename, code);
                // Second pass: establish connections between nodes using estraverse
                this.buildNodeConnectionsWithEstraverse(ast);
            }
            else {
                // Use custom traversal for Babel AST to avoid estraverse compatibility issues
                this.identifyNodesWithCustomTraversal(ast.program, filename, code);
                // Build connections with custom traversal
                this.buildNodeConnectionsWithCustomTraversal(ast.program);
            }
            // Third pass: calculate complexity and impact factors
            this.calculateMetrics();
            // Fourth pass: enhance with LLM insights
            await this.enhanceNodesWithLLMInsights();
            console.log(`Code analysis complete: ${this.nodes.size} nodes, ${this.edges.length} edges`);
        }
        catch (error) {
            console.error('Error analyzing code:', error);
            // Extract more detailed error information
            const errorDetails = {
                message: error.message,
                line: error.lineNumber || (error.loc ? error.loc.line : 'unknown'),
                column: error.column || (error.loc ? error.loc.column : 'unknown'),
                index: error.index || 'unknown',
                stack: error.stack
            };
            // Log detailed information for debugging
            console.error('Detailed parsing error:', errorDetails);
            // Show a more helpful error message with information about modern syntax
            vscode.window.showErrorMessage(`Failed to parse code: ${error.message}. Please open an issue with your code sample.`);
            throw error;
        }
    }
    hasSyntaxErrors(code) {
        // Simple check for basic syntax errors
        try {
            // Count brackets and braces
            let curlyBraceCount = 0;
            let squareBracketCount = 0;
            let parenthesisCount = 0;
            for (const char of code) {
                if (char === '{')
                    curlyBraceCount++;
                if (char === '}')
                    curlyBraceCount--;
                if (char === '[')
                    squareBracketCount++;
                if (char === ']')
                    squareBracketCount--;
                if (char === '(')
                    parenthesisCount++;
                if (char === ')')
                    parenthesisCount--;
                // If any count goes negative, we have a closing without opening
                if (curlyBraceCount < 0 || squareBracketCount < 0 || parenthesisCount < 0) {
                    return true;
                }
            }
            // If any count is non-zero at the end, we have an opening without closing
            if (curlyBraceCount !== 0 || squareBracketCount !== 0 || parenthesisCount !== 0) {
                return true;
            }
            // Look for common syntax errors
            const lines = code.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                // Look for statements without semicolons (simplified check)
                if (line && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') &&
                    !line.endsWith('(') && !line.startsWith('//') && !line.startsWith('/*') &&
                    !line.endsWith(':') && !line.startsWith('import') && !line.startsWith('export') &&
                    !line.endsWith(',') && !line.includes('=>') && !line.startsWith('class')) {
                    // Check if next line doesn't start with a dot (method chaining)
                    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
                    if (!nextLine.startsWith('.') && !nextLine.startsWith('?')) {
                        return true;
                    }
                }
            }
            return false;
        }
        catch (error) {
            // If anything goes wrong, assume there might be errors
            return true;
        }
    }
    // Convert Acorn AST to Esprima format for compatibility
    convertAcornToEsprima(acornAst) {
        // Simple conversion - copy key properties
        acornAst.type = 'Program';
        acornAst.sourceType = acornAst.sourceType || 'script';
        // Make sure ranges are arrays
        if (acornAst.range && !Array.isArray(acornAst.range)) {
            acornAst.range = [acornAst.start, acornAst.end];
        }
        // Make sure each node has the type property
        this.fixAcornNodes(acornAst);
        return acornAst;
    }
    // Recursively fix acorn nodes to match Esprima format
    fixAcornNodes(node) {
        if (!node || typeof node !== 'object')
            return;
        // Ensure type property exists
        if (node.type) {
            // Map Acorn types to Esprima types
            if (node.type === 'Literal') {
                // Add specific literal type property
                if (typeof node.value === 'number') {
                    node.type = 'Literal'; // Keep as Literal which estraverse understands
                    node.raw = String(node.value);
                }
            }
            // Convert loc format if needed
            if (node.loc && !node.loc.start && node.start !== undefined) {
                node.loc = {
                    start: { line: node.loc.line, column: node.loc.column },
                    end: { line: node.loc.line, column: node.loc.column + (node.end - node.start) }
                };
            }
            // Convert range format if needed
            if (!node.range && node.start !== undefined && node.end !== undefined) {
                node.range = [node.start, node.end];
            }
        }
        // Recursively process children
        for (const key in node) {
            if (key === 'type' || key === 'loc' || key === 'range')
                continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    this.fixAcornNodes(item);
                }
            }
            else if (child && typeof child === 'object') {
                this.fixAcornNodes(child);
            }
        }
    }
    // Add this helper method to pre-process code with problematic syntax
    preprocessCodeForParser(code) {
        // This is a simplified preprocessing approach for common modern JS features
        // 1. Handle optional chaining (?.)
        let processedCode = code.replace(/(\w+)(\?\.)/g, '$1.'); // Replace ?. with .
        // 2. Handle nullish coalescing (??)
        processedCode = processedCode.replace(/(\S+)\s*\?\?\s*(\S+)/g, '($1 !== null && $1 !== undefined) ? $1 : $2');
        // 3. Handle spread operator (...)
        processedCode = processedCode.replace(/\.{3}(\w+)/g, '/*spread*/$1')
            .replace(/\.{3}(\[)/g, '/*spread*/$1');
        // 4. Handle object property shorthand {a} -> {a: a}
        processedCode = processedCode.replace(/({)(\s*)([a-zA-Z_$][0-9a-zA-Z_$]*)(,|\s*})/g, '$1$2$3:$3$4');
        // 5. Handle template literals
        processedCode = processedCode.replace(/`([^`]*)`/g, (match, content) => {
            // Convert simple template literals to string literals
            return `"${content.replace(/"/g, '\\"')}"`;
        });
        return processedCode;
    }
    async performLLMAnalysis(code, filename) {
        try {
            // Get AI analysis of the code
            this.llmAnalysisResult = await this.llmService.analyzeCodeWithLLM(code, filename);
            console.log('LLM analysis complete');
        }
        catch (error) {
            console.error('Error performing LLM analysis:', error);
            // Continue without LLM insights if it fails
            this.llmAnalysisResult = null;
        }
    }
    identifyNodesWithEstraverse(ast, filename, code) {
        let nodeId = 0;
        // Load estraverse dynamically
        const estraverse = require('estraverse');
        try {
            estraverse.traverse(ast, {
                enter: (node, parent) => {
                    // Focus on significant nodes that would be valuable debugging points
                    if (this.isSignificantNode(node)) {
                        const id = `node_${nodeId++}`;
                        // Ensure node has location info
                        if (!node.loc) {
                            console.warn('Node missing location info:', node.type);
                            return;
                        }
                        const location = {
                            file: filename,
                            line: node.loc.start.line,
                            column: node.loc.start.column
                        };
                        // Extract variables used in this node
                        const variables = this.extractVariables(node);
                        // Calculate initial node complexity
                        const complexity = this.calculateNodeComplexity(node);
                        // Check if this location has historical errors
                        const errorKey = `${filename}:${node.loc.start.line}`;
                        const historicalErrors = this.historicalErrorData.get(errorKey) || 0;
                        // Store code snippet for this node
                        // Make sure node has range info
                        if (node.range) {
                            const snippet = code.substring(node.range[0], node.range[1]);
                            this.codeSnippets.set(id, snippet);
                        }
                        else if (node.start !== undefined && node.end !== undefined) {
                            // Handle alternate range format
                            const snippet = code.substring(node.start, node.end);
                            this.codeSnippets.set(id, snippet);
                        }
                        else {
                            // Use line information if range not available
                            const lines = code.split('\n');
                            if (node.loc.start.line <= lines.length) {
                                this.codeSnippets.set(id, lines[node.loc.start.line - 1]);
                            }
                        }
                        // Create the node
                        const codeNode = {
                            id,
                            type: node.type,
                            location,
                            complexity,
                            variables,
                            incoming: [],
                            outgoing: [],
                            metadata: {
                                isCritical: this.isCriticalNode(node),
                                isLoop: node.type.includes('Loop') || node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement',
                                isBranch: node.type === 'IfStatement' || node.type === 'SwitchStatement' || node.type === 'ConditionalExpression',
                                isErrorHandling: this.isErrorHandlingNode(node),
                                impactFactor: 0,
                                historicalErrors
                            }
                        };
                        this.nodes.set(id, codeNode);
                        // Store node ID in the AST node for reference in the connection-building pass
                        node._nodeId = id;
                    }
                }
            });
        }
        catch (traverseError) {
            console.error('Error during estraverse node identification:', traverseError);
            // Fallback to direct iteration over body for simple cases
            if (ast.body && Array.isArray(ast.body)) {
                console.log('Falling back to direct analysis of program body');
                this.identifyNodesDirectly(ast.body, filename, code);
            }
        }
    }
    // Fallback method for direct node identification without traversal
    identifyNodesDirectly(nodes, filename, code) {
        let nodeId = 0;
        for (const node of nodes) {
            if (!node || !node.type)
                continue;
            if (this.isSignificantNode(node)) {
                const id = `node_${nodeId++}`;
                if (!node.loc)
                    continue;
                const location = {
                    file: filename,
                    line: node.loc.start.line,
                    column: node.loc.start.column
                };
                // Extract variables used in this node
                const variables = this.extractVariables(node);
                // Calculate initial node complexity
                const complexity = this.calculateNodeComplexity(node);
                // Store code snippet if possible
                if (node.range) {
                    const snippet = code.substring(node.range[0], node.range[1]);
                    this.codeSnippets.set(id, snippet);
                }
                // Create the node
                const codeNode = {
                    id,
                    type: node.type,
                    location,
                    complexity,
                    variables,
                    incoming: [],
                    outgoing: [],
                    metadata: {
                        isCritical: this.isCriticalNode(node),
                        isLoop: node.type.includes('Loop') || node.type === 'ForStatement',
                        isBranch: node.type === 'IfStatement' || node.type === 'SwitchStatement',
                        isErrorHandling: this.isErrorHandlingNode(node),
                        impactFactor: 0,
                        historicalErrors: 0
                    }
                };
                this.nodes.set(id, codeNode);
                node._nodeId = id;
                // Look for child nodes to process
                if (node.body) {
                    if (Array.isArray(node.body)) {
                        this.identifyNodesDirectly(node.body, filename, code);
                    }
                    else if (node.body.type) {
                        this.identifyNodesDirectly([node.body], filename, code);
                    }
                }
            }
        }
    }
    // Custom traversal for Babel AST to avoid estraverse compatibility issues
    identifyNodesWithCustomTraversal(ast, filename, code, parent = null) {
        if (!ast || typeof ast !== 'object')
            return;
        let nodeId = this.nodes.size;
        // If this is a node with a type, check if it's significant
        if (ast.type && this.isSignificantNode(ast)) {
            const id = `node_${nodeId++}`;
            // Ensure node has location info
            if (!ast.loc) {
                // Try to infer location from parent if possible
                if (parent && parent.loc) {
                    ast.loc = parent.loc;
                }
                else {
                    console.warn('Node missing location info:', ast.type);
                    ast.loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
                }
            }
            const location = {
                file: filename,
                line: ast.loc.start.line,
                column: ast.loc.start.column
            };
            // Extract variables used in this node
            const variables = this.extractVariables(ast);
            // Calculate initial node complexity
            const complexity = this.calculateNodeComplexity(ast);
            // Check if this location has historical errors
            const errorKey = `${filename}:${ast.loc.start.line}`;
            const historicalErrors = this.historicalErrorData.get(errorKey) || 0;
            // Store code snippet for this node
            if (ast.start !== undefined && ast.end !== undefined) {
                const snippet = code.substring(ast.start, ast.end);
                this.codeSnippets.set(id, snippet);
            }
            else {
                // Use line information if range not available
                const lines = code.split('\n');
                if (ast.loc.start.line <= lines.length) {
                    this.codeSnippets.set(id, lines[ast.loc.start.line - 1]);
                }
            }
            // Create the node
            const codeNode = {
                id,
                type: ast.type,
                location,
                complexity,
                variables,
                incoming: [],
                outgoing: [],
                metadata: {
                    isCritical: this.isCriticalNode(ast),
                    isLoop: ast.type.includes('Loop') || ast.type === 'ForStatement' || ast.type === 'WhileStatement' || ast.type === 'DoWhileStatement',
                    isBranch: ast.type === 'IfStatement' || ast.type === 'SwitchStatement' || ast.type === 'ConditionalExpression',
                    isErrorHandling: this.isErrorHandlingNode(ast),
                    impactFactor: 0,
                    historicalErrors
                }
            };
            this.nodes.set(id, codeNode);
            // Store node ID in the AST node for reference in the connection-building pass
            ast._nodeId = id;
        }
        // Recursively process child nodes
        for (const key in ast) {
            if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === '_nodeId')
                continue;
            const child = ast[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    this.identifyNodesWithCustomTraversal(item, filename, code, ast);
                }
            }
            else if (child && typeof child === 'object') {
                this.identifyNodesWithCustomTraversal(child, filename, code, ast);
            }
        }
    }
    buildNodeConnectionsWithEstraverse(ast) {
        const estraverse = require('estraverse');
        try {
            estraverse.traverse(ast, {
                enter: (node, parent) => {
                    if (node._nodeId && parent && parent._nodeId) {
                        const fromId = parent._nodeId;
                        const toId = node._nodeId;
                        // Add connection from parent to this node
                        const fromNode = this.nodes.get(fromId);
                        const toNode = this.nodes.get(toId);
                        if (fromNode && toNode) {
                            if (!fromNode.outgoing.includes(toId)) {
                                fromNode.outgoing.push(toId);
                            }
                            if (!toNode.incoming.includes(fromId)) {
                                toNode.incoming.push(fromId);
                            }
                            // Determine if this is control flow or data flow
                            const edgeType = this.determineEdgeType(parent, node);
                            const sharedData = this.identifySharedData(parent, node);
                            this.edges.push({
                                from: fromId,
                                to: toId,
                                type: edgeType,
                                data: sharedData
                            });
                        }
                    }
                }
            });
        }
        catch (traverseError) {
            console.error('Error during connection building:', traverseError);
            // Fall back to simpler connection building by parent-child relationship
            this.buildDirectConnections();
        }
    }
    // Fallback method for building connections
    buildDirectConnections() {
        // Get all nodes with a parent to form connections
        const nodeArray = Array.from(this.nodes.values());
        // Create parent-child relationships based on code location
        for (const fromNode of nodeArray) {
            for (const toNode of nodeArray) {
                // Skip self connections
                if (fromNode.id === toNode.id)
                    continue;
                // Simple heuristic: if nodes are in the same file and the "to" node's line is after the "from" node's line
                if (fromNode.location.file === toNode.location.file &&
                    fromNode.location.line < toNode.location.line &&
                    // And the "to" node's line is close enough to be considered a child
                    toNode.location.line - fromNode.location.line < 5) {
                    if (!fromNode.outgoing.includes(toNode.id)) {
                        fromNode.outgoing.push(toNode.id);
                    }
                    if (!toNode.incoming.includes(fromNode.id)) {
                        toNode.incoming.push(fromNode.id);
                    }
                    // Default to control flow
                    this.edges.push({
                        from: fromNode.id,
                        to: toNode.id,
                        type: 'control',
                        data: []
                    });
                }
            }
        }
    }
    // Custom connection building for Babel AST
    buildNodeConnectionsWithCustomTraversal(ast, parent = null) {
        if (!ast || typeof ast !== 'object')
            return;
        // If this node and its parent both have nodeIds, create a connection
        if (ast._nodeId && parent && parent._nodeId) {
            const fromId = parent._nodeId;
            const toId = ast._nodeId;
            // Add connection from parent to this node
            const fromNode = this.nodes.get(fromId);
            const toNode = this.nodes.get(toId);
            if (fromNode && toNode) {
                if (!fromNode.outgoing.includes(toId)) {
                    fromNode.outgoing.push(toId);
                }
                if (!toNode.incoming.includes(fromId)) {
                    toNode.incoming.push(fromId);
                }
                // Determine if this is control flow or data flow
                const edgeType = this.determineEdgeType(parent, ast);
                const sharedData = this.identifySharedData(parent, ast);
                this.edges.push({
                    from: fromId,
                    to: toId,
                    type: edgeType,
                    data: sharedData
                });
            }
        }
        // Recursively process child nodes
        for (const key in ast) {
            if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === '_nodeId')
                continue;
            const child = ast[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    this.buildNodeConnectionsWithCustomTraversal(item, ast);
                }
            }
            else if (child && typeof child === 'object') {
                this.buildNodeConnectionsWithCustomTraversal(child, ast);
            }
        }
    }
    calculateMetrics() {
        // Calculate impact factor for each node based on downstream reach
        for (const node of this.nodes.values()) {
            node.metadata.impactFactor = this.calculateImpactFactor(node.id, new Set());
        }
    }
    async enhanceNodesWithLLMInsights() {
        if (!this.llmAnalysisResult)
            return;
        // 1. Process complex functions identified by LLM
        if (this.llmAnalysisResult.codeUnderstanding &&
            Array.isArray(this.llmAnalysisResult.codeUnderstanding.complexFunctions)) {
            for (const complexFunc of this.llmAnalysisResult.codeUnderstanding.complexFunctions) {
                // Skip if complexFunc is not a string
                if (typeof complexFunc !== 'string')
                    continue;
                // Try to match described complex functions to our nodes
                for (const [nodeId, node] of this.nodes.entries()) {
                    const snippet = this.codeSnippets.get(nodeId) || "";
                    // Check if this snippet matches the complex function description
                    if (this.snippetMatchesDescription(snippet, complexFunc)) {
                        // Enhance the node with LLM insights
                        node.metadata.semanticComplexity = (node.metadata.semanticComplexity || 0) + 3;
                        node.metadata.suggestedBreakpoints = true;
                        break;
                    }
                }
            }
        }
        // 2. Process potential bugs identified by LLM
        if (this.llmAnalysisResult.codeUnderstanding &&
            Array.isArray(this.llmAnalysisResult.codeUnderstanding.potentialBugs)) {
            for (const bug of this.llmAnalysisResult.codeUnderstanding.potentialBugs) {
                // Skip if bug description is not a string
                if (typeof bug !== 'string')
                    continue;
                for (const [nodeId, node] of this.nodes.entries()) {
                    const snippet = this.codeSnippets.get(nodeId) || "";
                    // Check if this snippet matches the bug description
                    if (this.snippetMatchesDescription(snippet, bug)) {
                        // Add potential bug to node metadata
                        if (!node.metadata.potentialBugs) {
                            node.metadata.potentialBugs = [];
                        }
                        node.metadata.potentialBugs.push(bug);
                        node.metadata.llmRiskScore = (node.metadata.llmRiskScore || 0) + 2;
                        node.metadata.suggestedBreakpoints = true;
                        break;
                    }
                }
            }
        }
        // 3. Process data flow insights
        if (this.llmAnalysisResult.codeUnderstanding &&
            Array.isArray(this.llmAnalysisResult.codeUnderstanding.dataFlowInsights)) {
            for (const insight of this.llmAnalysisResult.codeUnderstanding.dataFlowInsights) {
                // Skip if insight is not a string
                if (typeof insight !== 'string')
                    continue;
                // Enhance variable semantic understanding
                for (const [nodeId, node] of this.nodes.entries()) {
                    for (const variable of node.variables) {
                        if (insight.includes(variable.name)) {
                            // Extract semantic role from insight
                            const role = this.extractSemanticRole(insight, variable.name);
                            if (role) {
                                variable.semanticRole = role;
                                variable.importance += 1; // Increase importance for variables mentioned by LLM
                            }
                        }
                    }
                }
            }
        }
        // 4. Process suggested breakpoints from LLM
        if (Array.isArray(this.llmAnalysisResult.suggestions)) {
            for (const suggestion of this.llmAnalysisResult.suggestions) {
                // Skip if suggestion is not a string
                if (typeof suggestion !== 'string')
                    continue;
                // If the suggestion mentions a specific line or pattern, mark those nodes
                for (const [nodeId, node] of this.nodes.entries()) {
                    const snippet = this.codeSnippets.get(nodeId) || "";
                    if (this.suggestionAppliesToNode(suggestion, snippet, node)) {
                        node.metadata.suggestedBreakpoints = true;
                        // Also increase risk score for these nodes
                        node.metadata.llmRiskScore = (node.metadata.llmRiskScore || 0) + 1.5;
                    }
                }
            }
        }
    }
    snippetMatchesDescription(snippet, description) {
        // Check if description is a valid string before processing
        if (!description || typeof description !== 'string') {
            return false;
        }
        // Clean both strings for comparison
        const cleanSnippet = snippet.toLowerCase().replace(/\s+/g, ' ').trim();
        const cleanDesc = description.toLowerCase().replace(/\s+/g, ' ').trim();
        // Check for function names
        const functionMatch = snippet.match(/function\s+(\w+)/);
        if (functionMatch && cleanDesc.includes(functionMatch[1].toLowerCase())) {
            return true;
        }
        // Check for variable names
        const variableMatches = Array.from(snippet.matchAll(/\b(let|var|const)\s+(\w+)/g));
        for (const match of variableMatches) {
            if (cleanDesc.includes(match[2].toLowerCase())) {
                return true;
            }
        }
        // Check for key terms or phrases
        const terms = [
            "loop", "iteration", "condition", "branch", "check", "validate",
            "error", "exception", "try", "catch", "if", "else", "switch"
        ];
        for (const term of terms) {
            if (cleanSnippet.includes(term) && cleanDesc.includes(term)) {
                return true;
            }
        }
        return false;
    }
    extractSemanticRole(insight, variableName) {
        // Extract the semantic role of a variable from an LLM insight
        const lowerInsight = insight.toLowerCase();
        const lowerVarName = variableName.toLowerCase();
        // Common roles and their indicator phrases
        const roles = [
            { role: "counter", indicators: ["counter", "increment", "count", "iteration"] },
            { role: "accumulator", indicators: ["sum", "total", "accumulate", "aggregate"] },
            { role: "flag", indicators: ["flag", "indicator", "toggle", "boolean", "condition"] },
            { role: "control", indicators: ["control", "flow", "state", "status"] },
            { role: "input", indicators: ["input", "parameter", "argument"] },
            { role: "output", indicators: ["output", "result", "return", "response"] },
            { role: "temporary", indicators: ["temp", "temporary", "intermediate"] }
        ];
        // Find the closest sentence containing the variable name
        const sentences = insight.split(/[.!?]+/);
        const relevantSentences = sentences.filter(s => s.toLowerCase().includes(lowerVarName));
        if (relevantSentences.length === 0)
            return null;
        const context = relevantSentences.join(". ");
        // Check each role against the context
        for (const { role, indicators } of roles) {
            for (const indicator of indicators) {
                if (context.toLowerCase().includes(indicator)) {
                    return role;
                }
            }
        }
        return null;
    }
    suggestionAppliesToNode(suggestion, snippet, node) {
        // Check if an LLM suggestion applies to this specific node
        // 1. Check for line number references
        const lineMatch = suggestion.match(/line\s+(\d+)/i);
        if (lineMatch && parseInt(lineMatch[1]) === node.location.line) {
            return true;
        }
        // 2. Check for function names
        const functionMatch = snippet.match(/function\s+(\w+)/);
        if (functionMatch && suggestion.includes(functionMatch[1])) {
            return true;
        }
        // 3. Check for variable names in both
        const variableNames = node.variables.map(v => v.name);
        for (const varName of variableNames) {
            if (suggestion.includes(varName)) {
                return true;
            }
        }
        // 4. Check for code constructs
        if ((node.metadata.isLoop && suggestion.toLowerCase().includes("loop")) ||
            (node.metadata.isBranch && suggestion.toLowerCase().includes("condition")) ||
            (node.metadata.isErrorHandling && suggestion.toLowerCase().includes("error"))) {
            return true;
        }
        return false;
    }
    // Recursively calculate impact factor based on how many nodes this node affects
    calculateImpactFactor(nodeId, visited) {
        if (visited.has(nodeId)) {
            return 0; // Break cycles
        }
        visited.add(nodeId);
        const node = this.nodes.get(nodeId);
        if (!node) {
            return 0;
        }
        // Impact includes direct outgoing nodes plus their impacts
        let impact = node.outgoing.length;
        for (const outId of node.outgoing) {
            impact += this.calculateImpactFactor(outId, new Set(visited));
        }
        return impact;
    }
    isSignificantNode(node) {
        // Identify nodes that are significant for debugging
        const significantTypes = [
            'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
            'IfStatement', 'SwitchStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement',
            'TryStatement', 'CatchClause', 'ThrowStatement', 'CallExpression',
            'AssignmentExpression', 'BinaryExpression', 'ClassDeclaration', 'MethodDefinition',
            // Add modern node types
            'ClassProperty', 'ObjectMethod', 'ObjectProperty'
        ];
        return significantTypes.includes(node.type);
    }
    isCriticalNode(node) {
        // Identify nodes that are crucial for program correctness
        // This is a simplified implementation - would be more sophisticated in practice
        if (node.type === 'ThrowStatement')
            return true;
        if (node.type === 'ReturnStatement')
            return true;
        if (node.type === 'CallExpression' && node.callee &&
            ((node.callee.name && ['assert', 'validate', 'require', 'check'].includes(node.callee.name)) ||
                (node.callee.property && ['assert', 'validate', 'require', 'check'].includes(node.callee.property.name)))) {
            return true;
        }
        return false;
    }
    isErrorHandlingNode(node) {
        return node.type === 'TryStatement' ||
            node.type === 'CatchClause' ||
            node.type === 'ThrowStatement';
    }
    calculateNodeComplexity(node) {
        // A simplified complexity calculation
        // In reality, this would use more sophisticated metrics
        let complexity = 1;
        if (node.type === 'IfStatement') {
            complexity += 1;
            if (node.alternate)
                complexity += 1;
        }
        if (node.type === 'SwitchStatement' && node.cases) {
            complexity += node.cases.length;
        }
        if (node.type.includes('Loop') ||
            node.type === 'ForStatement' ||
            node.type === 'WhileStatement' ||
            node.type === 'DoWhileStatement') {
            complexity += 2;
        }
        return complexity;
    }
    extractVariables(node) {
        var _a;
        const variables = [];
        // This is a simplified implementation
        // A real implementation would do more thorough analysis of variable usage
        if (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression') {
            // Function parameters are inputs
            if (node.params) {
                for (const param of node.params) {
                    if (param.type === 'Identifier') {
                        variables.push({
                            name: param.name,
                            type: 'parameter',
                            isInput: true,
                            isOutput: false,
                            isDynamic: false,
                            importance: 2
                        });
                    }
                    else if (param.type === 'AssignmentPattern' && ((_a = param.left) === null || _a === void 0 ? void 0 : _a.type) === 'Identifier') {
                        // Handle default parameters
                        variables.push({
                            name: param.left.name,
                            type: 'parameter',
                            isInput: true,
                            isOutput: false,
                            isDynamic: false,
                            importance: 2
                        });
                    }
                    else if (param.type === 'ObjectPattern') {
                        // Handle destructuring parameters
                        this.extractDestructuringVariables(param, variables, 'parameter');
                    }
                    else if (param.type === 'ArrayPattern') {
                        // Handle array destructuring parameters
                        this.extractArrayDestructuringVariables(param, variables, 'parameter');
                    }
                }
            }
        }
        if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') {
                    variables.push({
                        name: decl.id.name,
                        type: 'variable',
                        isInput: false,
                        isOutput: false,
                        isDynamic: !!decl.init,
                        importance: 1
                    });
                }
                else if (decl.id && decl.id.type === 'ObjectPattern') {
                    // Handle object destructuring
                    this.extractDestructuringVariables(decl.id, variables, 'variable');
                }
                else if (decl.id && decl.id.type === 'ArrayPattern') {
                    // Handle array destructuring
                    this.extractArrayDestructuringVariables(decl.id, variables, 'variable');
                }
            }
        }
        if (node.type === 'AssignmentExpression') {
            if (node.left && node.left.type === 'Identifier') {
                variables.push({
                    name: node.left.name,
                    type: 'assignment',
                    isInput: false,
                    isOutput: true,
                    isDynamic: true,
                    importance: 2
                });
            }
            else if (node.left && node.left.type === 'MemberExpression' &&
                node.left.object && node.left.object.type === 'Identifier') {
                // Handle properties like obj.prop = value
                let propName = '(computed)';
                if (node.left.property.type === 'Identifier') {
                    propName = node.left.property.name;
                }
                else if (node.left.property.type === 'Literal' || node.left.property.type === 'StringLiteral') {
                    propName = node.left.property.value;
                }
                variables.push({
                    name: `${node.left.object.name}.${propName}`,
                    type: 'property',
                    isInput: false,
                    isOutput: true,
                    isDynamic: true,
                    importance: 1.5
                });
            }
        }
        return variables;
    }
    // Helper method to extract variables from object destructuring patterns
    extractDestructuringVariables(pattern, variables, type) {
        if (!pattern.properties)
            return;
        for (const prop of pattern.properties) {
            if (prop.key && prop.key.type === 'Identifier') {
                let varName = '';
                // Handle different forms of destructuring
                if (prop.value && prop.value.type === 'Identifier') {
                    // { key: varName }
                    varName = prop.value.name;
                }
                else if (!prop.value) {
                    // { key } shorthand
                    varName = prop.key.name;
                }
                if (varName) {
                    variables.push({
                        name: varName,
                        type: type,
                        isInput: type === 'parameter',
                        isOutput: false,
                        isDynamic: false,
                        importance: 1.5
                    });
                }
            }
        }
    }
    // Helper method to extract variables from array destructuring patterns
    extractArrayDestructuringVariables(pattern, variables, type) {
        if (!pattern.elements)
            return;
        for (const elem of pattern.elements) {
            if (elem && elem.type === 'Identifier') {
                variables.push({
                    name: elem.name,
                    type: type,
                    isInput: type === 'parameter',
                    isOutput: false,
                    isDynamic: false,
                    importance: 1.5
                });
            }
        }
    }
    determineEdgeType(parent, node) {
        // Simplified logic to determine edge type
        // Control flow: parent controls execution of child
        // Data flow: parent passes data to child
        if (parent.type === 'IfStatement' ||
            parent.type === 'SwitchStatement' ||
            parent.type.includes('Loop') ||
            parent.type === 'ForStatement' ||
            parent.type === 'WhileStatement' ||
            parent.type === 'DoWhileStatement') {
            return 'control';
        }
        if (parent.type === 'CallExpression' && node.type === 'Identifier') {
            return 'data'; // Argument to function call
        }
        if (parent.type === 'AssignmentExpression') {
            return 'data';
        }
        return 'control'; // Default to control flow
    }
    identifySharedData(parent, node) {
        // Identify variables passed from parent to child
        // This is a simplified implementation
        const shared = [];
        // Example: function call arguments
        if (parent.type === 'CallExpression' && parent.arguments &&
            parent.arguments.includes(node) && node.type === 'Identifier') {
            shared.push(node.name);
        }
        return shared;
    }
    // Public methods to access the analyzed data
    getNodes() {
        return this.nodes;
    }
    getEdges() {
        return this.edges;
    }
    getNodeAt(filename, line) {
        for (const node of this.nodes.values()) {
            if (node.location.file === filename && node.location.line === line) {
                return node;
            }
        }
        return undefined;
    }
    getNodesInFile(filename) {
        return Array.from(this.nodes.values())
            .filter(node => node.location.file === filename);
    }
    getCodeSnippet(nodeId) {
        return this.codeSnippets.get(nodeId) || "";
    }
}
exports.CodeAnalyzer = CodeAnalyzer;
//# sourceMappingURL=codeAnalyzer.js.map