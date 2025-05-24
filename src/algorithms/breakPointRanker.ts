import * as vscode from 'vscode';
import { CodeNode } from '../codeAnalyzer';

/**
 * Ranks nodes for intelligent breakpoint placement
 */
export class BreakpointRanker {
    constructor() {}
    
    /**
     * Ranks nodes to determine optimal breakpoint placement
     * @param nodes Array of code nodes to rank
     * @returns Array of nodes sorted by their breakpoint suitability
     */
    public rankNodesForBreakpoints(nodes: CodeNode[]): CodeNode[] {
        // Calculate a score for each node
        const scoredNodes = nodes.map(node => {
            const score = this.calculateBreakpointScore(node);
            return { node, score };
        });
        
        // Sort by score (highest first)
        scoredNodes.sort((a, b) => b.score - a.score);
        
        // Return sorted nodes
        return scoredNodes.map(item => item.node);
    }

    /**
     * Rank nodes for breakpoints with a specific debugging focus
     */
    public async rankNodesForBreakpointsWithFocus(nodes: any[], debugFocus: string): Promise<any[]> {
        // Create a copy of nodes to rank
        const nodesToRank = [...nodes];

        // Compute relevance scores based on the debug focus
        for (const node of nodesToRank) {
            // Base score from standard ranking
            const baseScore = this.calculateBreakpointScore(node);
            
            // Calculate relevance to debugging focus
            const focusRelevance = this.calculateFocusRelevance(node, debugFocus);
            
            // Combine scores, giving higher weight to focus relevance
            node.rankingScore = baseScore * 0.4 + focusRelevance * 0.6;
        }
        
        // Sort by the new combined score
        nodesToRank.sort((a, b) => b.rankingScore - a.rankingScore);
        
        return nodesToRank;
    }

/**
 * Calculate how relevant a node is to the debugging focus
 */
private calculateFocusRelevance(node: any, debugFocus: string): number {
    let score = 0;
    const focusLower = debugFocus.toLowerCase();
    
    // Check if node's code snippet contains terms from the debug focus
    if (node.snippet) {
        const snippetLower = node.snippet.toLowerCase();
        if (snippetLower.includes(focusLower)) {
            score += 3; // Direct mention is highly relevant
        }
        
        // Check for related terms
        const terms = focusLower.split(/\s+/);
        for (const term of terms) {
            if (term.length >= 4 && snippetLower.includes(term)) {
                score += 1;
            }
        }
    }
    
    // Check if functionality/metadata matches the focus
    if (node.metadata) {
        // Focus on validation code
        if (focusLower.includes('valid') && 
            (node.snippet?.toLowerCase().includes('valid') || 
             node.name?.toLowerCase().includes('valid'))) {
            score += 2;
        }
        
        // Focus on error handling
        if ((focusLower.includes('error') || focusLower.includes('exception')) &&
            node.metadata.isErrorHandling) {
            score += 3;
        }
        
        // Focus on data processing
        if ((focusLower.includes('process') || focusLower.includes('data')) &&
            (node.snippet?.toLowerCase().includes('process') || 
             node.name?.toLowerCase().includes('process') ||
             node.metadata.isDataProcessing)) {
            score += 2;
        }
    }
    
    return Math.min(score, 5) / 5; // Normalize to 0-1 scale
}
    
    private calculateBreakpointScore(node: CodeNode): number {
        let score = 0;
        
        // Base score from complexity
        score += Math.min(node.complexity / 10, 1) * 20;
        
        // Critical nodes are good breakpoint candidates
        if (node.metadata.isCritical) {
            score += 15;
        }
        
        // Nodes with historical errors
        score += Math.min(node.metadata.historicalErrors / 5, 1) * 15;
        
        // Nodes with high downstream impact
        score += Math.min(node.metadata.impactFactor / 20, 1) * 20;
        
        // Branch points and loops are good to break at
        if (node.metadata.isBranch || node.metadata.isLoop) {
            score += 10;
        }
        
        // Consider LLM-specific factors
        if (node.metadata.llmRiskScore) {
            score += Math.min(node.metadata.llmRiskScore / 5, 1) * 10;
        }
        
        if (node.metadata.semanticComplexity) {
            score += Math.min(node.metadata.semanticComplexity / 5, 1) * 6;
        }
        
        if (node.metadata.suggestedBreakpoints) {
            score += 20;
        }
        
        if (node.metadata.potentialBugs && node.metadata.potentialBugs.length > 0) {
            score += 10 * Math.min(node.metadata.potentialBugs.length, 3);
        }
        
        return score;
    }
}