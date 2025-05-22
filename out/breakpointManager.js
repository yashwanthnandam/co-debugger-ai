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
exports.BreakpointManager = void 0;
const vscode = __importStar(require("vscode"));
const llmService_1 = require("./llmService");
class BreakpointManager {
    constructor(analyzer, llmService) {
        this.rankedBreakpoints = [];
        // Weights for different scoring factors
        this.weights = {
            complexity: 0.20,
            criticality: 0.15,
            historicalErrors: 0.15,
            impactFactor: 0.20,
            branchFactor: 0.10,
            llmScore: 0.20 // New weight for LLM-based scoring
        };
        this.analyzer = analyzer;
        this.llmService = llmService || new llmService_1.LLMService();
    }
    async rankBreakpoints() {
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
            const breakpoint = {
                id: `bp_${nodeId}`,
                uri: vscode.Uri.file(node.location.file),
                line: node.location.line - 1,
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
    calculateBreakpointScore(node) {
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
    getKeyVariablesToWatch(node) {
        // Select the most important variables at this node based on:
        // 1. Variables with high importance from static analysis
        // 2. Variables mentioned in LLM insights
        // 3. Variables with semantic roles identified by LLM
        // Create a map of variables with initial scores from static analysis
        const variableScores = new Map();
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
            if (variable.isInput)
                score += 0.5;
            if (variable.isOutput)
                score += 0.5;
            variableScores.set(variable.name, score);
        }
        // Sort variables by score and take top ones
        return Array.from(variableScores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0])
            .slice(0, 5); // Limit to top 5 variables
    }
    getLLMInsightsForNode(node) {
        var _a;
        const insights = [];
        // Add potential bugs identified by LLM
        if ((_a = node.metadata.potentialBugs) === null || _a === void 0 ? void 0 : _a.length) {
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
    generateBreakpointReason(node, score) {
        // Generate a human-readable explanation for why this breakpoint is important
        const reasons = [];
        if (node.complexity > 5)
            reasons.push("High complexity");
        if (node.metadata.isCritical)
            reasons.push("Critical logic");
        if (node.metadata.historicalErrors > 0)
            reasons.push(`${node.metadata.historicalErrors} historical errors`);
        if (node.metadata.impactFactor > 10)
            reasons.push("High downstream impact");
        if (node.metadata.isBranch)
            reasons.push("Important branch point");
        if (node.metadata.isLoop)
            reasons.push("Loop structure");
        if (node.metadata.isErrorHandling)
            reasons.push("Error handling logic");
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
    async getTopBreakpoints(limit) {
        const config = vscode.workspace.getConfiguration('intelligentDebugger');
        const maxBreakpoints = limit || config.get('maxBreakpoints') || 10;
        // Return the top N breakpoints
        return this.rankedBreakpoints.slice(0, maxBreakpoints);
    }
    getStaticAnalysisIssues() {
        // Return the LLM analysis results for static issues
        if (this.analyzer && this.analyzer.getLLMAnalysisResult) {
            return this.analyzer.getLLMAnalysisResult();
        }
        return null;
    }
    getBreakpointById(id) {
        return this.rankedBreakpoints.find(bp => bp.id === id);
    }
    getAllBreakpoints() {
        return [...this.rankedBreakpoints];
    }
}
exports.BreakpointManager = BreakpointManager;
//# sourceMappingURL=breakpointManager.js.map