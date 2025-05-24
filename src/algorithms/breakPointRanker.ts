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