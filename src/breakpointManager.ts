import * as vscode from 'vscode';
import { CodeAnalyzer, CodeNode } from './codeAnalyzer';
import { LLMService } from './llmService';

export interface IntelligentBreakpoint {
    id: string;
    uri: vscode.Uri;
    line: number;
    column: number;
    score: number;
    reason: string;
    nodeId: string;
    variables: string[]; // Key variables to watch at this breakpoint
    llmInsights?: string[]; // LLM-provided insights about this breakpoint
}

export class BreakpointManager {
    private analyzer: CodeAnalyzer;
    private rankedBreakpoints: IntelligentBreakpoint[] = [];
    private llmService: LLMService;
    
    // Weights for different scoring factors
    private weights = {
        complexity: 0.20,
        criticality: 0.15,
        historicalErrors: 0.15,
        impactFactor: 0.20,
        branchFactor: 0.10,
        llmScore: 0.20 // New weight for LLM-based scoring
    };
    
    constructor(analyzer: CodeAnalyzer, llmService?: LLMService) {
        this.analyzer = analyzer;
        this.llmService = llmService || new LLMService();
    }
    
    public async rankBreakpoints(): Promise<void> {
        this.rankedBreakpoints = [];
        const nodes = this.analyzer.getNodes();
        
        for (const [nodeId, node] of nodes.entries()) {
            // Calculate a score for this node based on weighted factors
            const score = this.calculateBreakpointScore(node);
            
            // Get key variables to watch at this breakpoint
            const watchVariables = this.getKeyVariablesToWatch(node);
            
            // Get LLM insights for this node if available
            const llmInsights = this.getLLMInsightsForNode(node);
            
            // Create a breakpoint record
            const breakpoint: IntelligentBreakpoint = {
                id: `bp_${nodeId}`,
                uri: vscode.Uri.file(node.location.file),
                line: node.location.line - 1, // VS Code uses 0-based line numbers
                column: node.location.column,
                score,
                reason: this.generateBreakpointReason(node, score),
                nodeId,
                variables: watchVariables,
                llmInsights
            };
            
            this.rankedBreakpoints.push(breakpoint);
        }
        
        // Sort breakpoints by score in descending order
        this.rankedBreakpoints.sort((a, b) => b.score - a.score);
    }
    
    private calculateBreakpointScore(node: CodeNode): number {
        // Normalize each factor to a 0-1 scale and apply weights
        const complexityScore = Math.min(node.complexity / 10, 1) * this.weights.complexity;
        
        const criticalityScore = (node.metadata.isCritical ? 1 : 0) * this.weights.criticality;
        
        const historicalErrorScore = Math.min(node.metadata.historicalErrors / 5, 1) * 
                                     this.weights.historicalErrors;
        
        const impactScore = Math.min(node.metadata.impactFactor / 20, 1) * this.weights.impactFactor;
        
        const branchScore = ((node.metadata.isBranch || node.metadata.isLoop) ? 1 : 0) * 
                            this.weights.branchFactor;
        
        // Add LLM-based scoring factors
        let llmScore = 0;
        if (node.metadata.llmRiskScore) {
            llmScore += Math.min(node.metadata.llmRiskScore / 5, 1) * 0.5;
        }
        if (node.metadata.semanticComplexity) {
            llmScore += Math.min(node.metadata.semanticComplexity / 5, 1) * 0.3;
        }
        if (node.metadata.suggestedBreakpoints) {
            llmScore += 0.2;
        }
        llmScore = llmScore * this.weights.llmScore;
        
        // Combine all factors
        return complexityScore + criticalityScore + historicalErrorScore + impactScore + branchScore + llmScore;
    }
    
    private getKeyVariablesToWatch(node: CodeNode): string[] {
        // Select the most important variables at this node based on:
        // 1. Variables with high importance from static analysis
        // 2. Variables mentioned in LLM insights
        // 3. Variables with semantic roles identified by LLM
        
        // Create a map of variables with initial scores from static analysis
        const variableScores: Map<string, number> = new Map();
        
        for (const variable of node.variables) {
            // Start with the base importance
            let score = variable.importance;
            
            // Boost score for variables with semantic roles
            if (variable.semanticRole) {
                score += 1;
                
                // Extra boost for certain critical roles
                if (['counter', 'flag', 'control'].includes(variable.semanticRole)) {
                    score += 0.5;
                }
            }
            
            // Boost for input/output variables
            if (variable.isInput) score += 0.5;
            if (variable.isOutput) score += 0.5;
            
            variableScores.set(variable.name, score);
        }
        
        // Sort variables by score and take top ones
        return Array.from(variableScores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0])
            .slice(0, 5);  // Limit to top 5 variables
    }
    
    private getLLMInsightsForNode(node: CodeNode): string[] {
        const insights: string[] = [];
        
        // Add potential bugs identified by LLM
        if (node.metadata.potentialBugs?.length) {
            insights.push(...node.metadata.potentialBugs.map(bug => `Potential issue: ${bug}`));
        }
        
        // Add variable-specific insights
        for (const variable of node.variables) {
            if (variable.semanticRole) {
                insights.push(`"${variable.name}" acts as a ${variable.semanticRole} in this context`);
            }
        }
        
        return insights;
    }
    
    private generateBreakpointReason(node: CodeNode, score: number): string {
        // Generate a human-readable explanation for why this breakpoint is important
        const reasons: string[] = [];
        
        if (node.complexity > 5) reasons.push("High complexity");
        if (node.metadata.isCritical) reasons.push("Critical logic");
        if (node.metadata.historicalErrors > 0) reasons.push(`${node.metadata.historicalErrors} historical errors`);
        if (node.metadata.impactFactor > 10) reasons.push("High downstream impact");
        if (node.metadata.isBranch) reasons.push("Important branch point");
        if (node.metadata.isLoop) reasons.push("Loop structure");
        if (node.metadata.isErrorHandling) reasons.push("Error handling logic");
        
        // Add LLM-based reasons
        if (node.metadata.llmRiskScore && node.metadata.llmRiskScore > 2) {
            reasons.push("High risk area (LLM)");
        }
        if (node.metadata.semanticComplexity && node.metadata.semanticComplexity > 2) {
            reasons.push("Semantically complex (LLM)");
        }
        if (node.metadata.suggestedBreakpoints) {
            reasons.push("AI-recommended breakpoint");
        }
        
        return `Score: ${score.toFixed(2)} - ${reasons.join(", ")}`;
    }

    public getCodeAnalyzer(): CodeAnalyzer {
        return this.analyzer;
    }
    
    public async getTopBreakpoints(limit?: number): Promise<IntelligentBreakpoint[]> {
        const config = vscode.workspace.getConfiguration('intelligentDebugger');
        const maxBreakpoints = limit || config.get<number>('maxBreakpoints') || 10;
        
        // Return the top N breakpoints
        return this.rankedBreakpoints.slice(0, maxBreakpoints);
    }

    public getStaticAnalysisIssues(): any {
        // Return the LLM analysis results for static issues
        if (this.analyzer && this.analyzer.getLLMAnalysisResult) {
            return this.analyzer.getLLMAnalysisResult();
        }
        return null;
    }
    
    public getBreakpointById(id: string): IntelligentBreakpoint | undefined {
        return this.rankedBreakpoints.find(bp => bp.id === id);
    }
    
    public getAllBreakpoints(): IntelligentBreakpoint[] {
        return [...this.rankedBreakpoints];
    }

    // Add these methods to your BreakpointManager class

    public async addBreakpoint(
        uri: vscode.Uri,
        line: number,
        column: number,
        nodeId: string,
        reason: string
    ): Promise<IntelligentBreakpoint> {
        // Create a new intelligent breakpoint
        const bp: IntelligentBreakpoint = {
            id: `bp_${nodeId}`,
            uri,
            line,
            column,
            score: 1.0, // Default score
            reason,
            nodeId,
            variables: []
        };
        
        // Find the node to get more metadata
        const node = this.analyzer.getNodes().get(nodeId);
        if (node) {
            bp.score = this.calculateBreakpointScore(node);
            bp.variables = this.getKeyVariablesToWatch(node);
        }
        
        // Add to ranked breakpoints if not already there
        const existing = this.rankedBreakpoints.findIndex(b => b.id === bp.id);
        if (existing >= 0) {
            this.rankedBreakpoints[existing] = bp;
        } else {
            this.rankedBreakpoints.push(bp);
        }
        
        // Create a VS Code breakpoint
        const location = new vscode.Location(uri, new vscode.Position(line, column));
        const vscodeBreakpoint = new vscode.SourceBreakpoint(location);
        vscode.debug.addBreakpoints([vscodeBreakpoint]);
        
        return bp;
    }

    public getBreakpointAt(uri: vscode.Uri, line: number): IntelligentBreakpoint | undefined {
        return this.rankedBreakpoints.find(bp => 
            bp.uri.fsPath === uri.fsPath && bp.line === line
        );
    }

    public clearBreakpoints(): void {
        this.rankedBreakpoints = [];
        // Also clear VS Code breakpoints
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    }

    /**
     * Get all breakpoints for a specific URI
     * @param uri The URI to filter breakpoints for
     * @returns Array of breakpoints for the specified URI
     */
    public getBreakpointsForUri(uri: vscode.Uri): IntelligentBreakpoint[] {
        if (!uri) return [];
        
        // Filter breakpoints to only those matching the provided URI
        return this.rankedBreakpoints.filter(bp => 
            bp.uri.fsPath === uri.fsPath
        );
    }
}
