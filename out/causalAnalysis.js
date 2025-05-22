"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CausalAnalysis = void 0;
const llmService_1 = require("./llmService");
class CausalAnalysis {
    constructor(dataCollector, llmService, codeAnalyzer) {
        this.causalGraph = [];
        this.dataCollector = dataCollector;
        this.llmService = llmService || new llmService_1.LLMService();
        this.codeAnalyzer = codeAnalyzer;
    }
    async buildCausalGraph() {
        this.causalGraph = [];
        const allSeries = this.dataCollector.getAllDataSeries();
        // Build a graph of potential causal relationships between variables
        for (const series of allSeries) {
            await this.analyzeBreakpointData(series);
        }
        // Filter out weak relationships
        this.causalGraph = this.causalGraph.filter(rel => rel.strength > 0.3);
        // Sort by strength
        this.causalGraph.sort((a, b) => b.strength - a.strength);
        return this.causalGraph;
    }
    async analyzeBreakpointData(series) {
        if (series.data.length < 2)
            return; // Need multiple data points
        // Get all variable names
        const varNames = new Set();
        for (const dataPoint of series.data) {
            for (const variable of dataPoint.variables) {
                varNames.add(variable.name);
            }
        }
        // For each pair of variables, check for causal relationships
        const variables = Array.from(varNames);
        for (let i = 0; i < variables.length; i++) {
            const causeVar = variables[i];
            for (let j = 0; j < variables.length; j++) {
                if (i === j)
                    continue;
                const effectVar = variables[j];
                // Calculate temporal precedence and correlation
                const relationship = await this.calculateCausalRelationship(causeVar, effectVar, series);
                if (relationship.strength > 0) {
                    this.causalGraph.push(relationship);
                }
            }
        }
    }
    async calculateCausalRelationship(causeVar, effectVar, series) {
        // This is a simplified implementation of causal inference
        // In a real implementation, this would use more sophisticated techniques
        const evidence = [];
        let strength = 0;
        // Extract time series for both variables
        const causeValues = [];
        const effectValues = [];
        for (const dataPoint of series.data) {
            const causeVarInfo = dataPoint.variables.find(v => v.name === causeVar);
            const effectVarInfo = dataPoint.variables.find(v => v.name === effectVar);
            if (causeVarInfo && effectVarInfo) {
                causeValues.push({
                    value: causeVarInfo.value,
                    timestamp: dataPoint.timestamp
                });
                effectValues.push({
                    value: effectVarInfo.value,
                    timestamp: dataPoint.timestamp
                });
            }
        }
        if (causeValues.length < 2) {
            return {
                cause: causeVar,
                effect: effectVar,
                strength: 0,
                evidence: []
            };
        }
        // 1. Check temporal precedence
        const temporalScore = this.checkTemporalPrecedence(causeValues, effectValues);
        if (temporalScore > 0) {
            evidence.push(`Changes in ${causeVar} tend to precede changes in ${effectVar}`);
            strength += temporalScore * 0.4; // Temporal precedence contributes 40% to the score
        }
        // 2. Check correlation
        const correlationScore = this.calculateCorrelation(causeValues, effectValues);
        if (Math.abs(correlationScore) > 0.5) {
            const direction = correlationScore > 0 ? "positive" : "negative";
            evidence.push(`${causeVar} and ${effectVar} have a ${direction} correlation of ${Math.abs(correlationScore).toFixed(2)}`);
            strength += Math.abs(correlationScore) * 0.3; // Correlation contributes 30% to the score
        }
        // 3. Check for anomaly co-occurrence
        const anomalyScore = this.checkAnomalyCooccurrence(causeVar, effectVar, series);
        if (anomalyScore > 0) {
            evidence.push(`Anomalies in ${causeVar} often precede anomalies in ${effectVar}`);
            strength += anomalyScore * 0.3; // Anomaly co-occurrence contributes 30% to the score
        }
        return {
            cause: causeVar,
            effect: effectVar,
            strength,
            evidence
        };
    }
    checkTemporalPrecedence(causeValues, effectValues) {
        // Check if changes in the cause variable tend to precede changes in the effect variable
        let precedenceCount = 0;
        let totalChanges = 0;
        // Calculate differences
        const causeDiffs = [];
        const effectDiffs = [];
        for (let i = 1; i < causeValues.length; i++) {
            if (typeof causeValues[i].value === 'number' && typeof causeValues[i - 1].value === 'number') {
                causeDiffs.push({
                    diff: causeValues[i].value - causeValues[i - 1].value,
                    timestamp: causeValues[i].timestamp
                });
            }
        }
        for (let i = 1; i < effectValues.length; i++) {
            if (typeof effectValues[i].value === 'number' && typeof effectValues[i - 1].value === 'number') {
                effectDiffs.push({
                    diff: effectValues[i].value - effectValues[i - 1].value,
                    timestamp: effectValues[i].timestamp
                });
            }
        }
        // Check for precedence patterns
        for (const causeDiff of causeDiffs) {
            if (Math.abs(causeDiff.diff) < 0.0001)
                continue; // Ignore tiny changes
            totalChanges++;
            // Look for effect changes that follow this cause change
            for (const effectDiff of effectDiffs) {
                if (Math.abs(effectDiff.diff) < 0.0001)
                    continue;
                // Check if effect change follows cause change within a reasonable time window
                const timeDiff = effectDiff.timestamp - causeDiff.timestamp;
                if (timeDiff > 0 && timeDiff < 1000) { // Within 1 second
                    precedenceCount++;
                    break;
                }
            }
        }
        return totalChanges > 0 ? precedenceCount / totalChanges : 0;
    }
    calculateCorrelation(causeValues, effectValues) {
        // Calculate Pearson correlation coefficient
        if (causeValues.length < 3)
            return 0;
        // Extract numeric values only
        const x = [];
        const y = [];
        for (let i = 0; i < causeValues.length; i++) {
            if (typeof causeValues[i].value === 'number' && typeof effectValues[i].value === 'number') {
                x.push(causeValues[i].value);
                y.push(effectValues[i].value);
            }
        }
        if (x.length < 3)
            return 0;
        // Calculate means
        const meanX = x.reduce((sum, val) => sum + val, 0) / x.length;
        const meanY = y.reduce((sum, val) => sum + val, 0) / y.length;
        // Calculate correlation coefficient
        let numerator = 0;
        let denomX = 0;
        let denomY = 0;
        for (let i = 0; i < x.length; i++) {
            const xDiff = x[i] - meanX;
            const yDiff = y[i] - meanY;
            numerator += xDiff * yDiff;
            denomX += xDiff * xDiff;
            denomY += yDiff * yDiff;
        }
        const denominator = Math.sqrt(denomX * denomY);
        return denominator === 0 ? 0 : numerator / denominator;
    }
    checkAnomalyCooccurrence(causeVar, effectVar, series) {
        // Check if anomalies in the cause variable tend to precede anomalies in the effect variable
        const stats = series.variableStatistics;
        const causeStats = stats.get(causeVar);
        const effectStats = stats.get(effectVar);
        if (!causeStats || !effectStats)
            return 0;
        if (causeStats.anomalies.length === 0 || effectStats.anomalies.length === 0)
            return 0;
        let precedingAnomalies = 0;
        // Check each cause anomaly
        for (const causeAnomaly of causeStats.anomalies) {
            // Look for effect anomalies that follow this cause anomaly
            for (const effectAnomaly of effectStats.anomalies) {
                const timeDiff = effectAnomaly.timestamp - causeAnomaly.timestamp;
                if (timeDiff > 0 && timeDiff < 2000) { // Within 2 seconds
                    precedingAnomalies++;
                    break;
                }
            }
        }
        return precedingAnomalies / causeStats.anomalies.length;
    }
    async findRootCauses() {
        const rootCauses = [];
        // Build causal graph if not already built
        if (this.causalGraph.length === 0) {
            await this.buildCausalGraph();
        }
        // Look for variables that are more likely to be causes than effects
        const causeScores = new Map();
        const effectScores = new Map();
        // Calculate how often each variable appears as a cause or effect
        for (const rel of this.causalGraph) {
            causeScores.set(rel.cause, (causeScores.get(rel.cause) || 0) + rel.strength);
            effectScores.set(rel.effect, (effectScores.get(rel.effect) || 0) + rel.strength);
        }
        // Find variables that are strong causes but weak effects
        const potentialRootCauses = Array.from(causeScores.entries())
            .filter(([variable, causeScore]) => {
            const effectScore = effectScores.get(variable) || 0;
            return causeScore > effectScore * 1.5; // Significantly more cause than effect
        })
            .sort((a, b) => b[1] - a[1]); // Sort by cause score
        // For each potential root cause, gather evidence and generate description
        for (const [variable, score] of potentialRootCauses) {
            // Find which data series contain this variable
            const seriesWithVar = this.dataCollector.getAllDataSeries()
                .filter(series => {
                if (series.data.length === 0)
                    return false;
                return series.data[0].variables.some(v => v.name === variable);
            });
            if (seriesWithVar.length === 0)
                continue;
            // Use the first series that contains this variable
            const series = seriesWithVar[0];
            // Get all relationships where this variable is a cause
            const relationships = this.causalGraph
                .filter(rel => rel.cause === variable)
                .sort((a, b) => b.strength - a.strength);
            if (relationships.length === 0)
                continue;
            // Find code context if code analyzer is available
            let codeContext = "";
            let nodeId = "";
            if (this.codeAnalyzer) {
                const nodes = Array.from(this.codeAnalyzer.getNodes().values());
                for (const node of nodes) {
                    if (node.variables.some(v => v.name === variable)) {
                        codeContext = this.codeAnalyzer.getCodeSnippet(node.id);
                        nodeId = node.id;
                        break;
                    }
                }
            }
            // Generate description and confidence
            const description = `${variable} appears to be a root cause affecting ${relationships.map(r => r.effect).join(", ")}`;
            const confidence = score / 2; // Normalize to 0-1 range
            // Generate fixes
            const fixes = [];
            // Use LLM to analyze root cause if we have code context
            let llmInsight;
            if (codeContext) {
                try {
                    // Prepare relevant data for LLM analysis
                    const anomalyData = {
                        variable,
                        values: series.data.map(d => {
                            const varValue = d.variables.find(v => v.name === variable);
                            return varValue ? varValue.value : null;
                        }),
                        relationships: relationships.map(r => ({
                            effect: r.effect,
                            strength: r.strength,
                            evidence: r.evidence
                        }))
                    };
                    // Get execution history for context
                    const executionHistory = series.data.map(d => ({
                        timestamp: d.timestamp,
                        iteration: d.iterationCount,
                        anomalyScore: d.anomalyScore || 0,
                        variables: Object.fromEntries(d.variables.map(v => [v.name, v.value]))
                    }));
                    // Get LLM analysis
                    llmInsight = await this.llmService.analyzeRootCause(anomalyData, codeContext, executionHistory);
                    // Add LLM-suggested fixes
                    if (llmInsight.potentialFixes.length > 0) {
                        fixes.push(...llmInsight.potentialFixes);
                    }
                }
                catch (error) {
                    console.error("Error getting LLM root cause analysis:", error);
                }
            }
            // If no LLM fixes, generate simple suggestions
            if (fixes.length === 0) {
                fixes.push(`Check the initialization and updates of ${variable}`);
                fixes.push(`Add bounds checking for ${variable}`);
                fixes.push(`Validate the values of ${variable} before use`);
            }
            // Add to root causes
            rootCauses.push({
                variable,
                breakpointId: series.breakpointId,
                description: (llmInsight === null || llmInsight === void 0 ? void 0 : llmInsight.description) || description,
                confidence: (llmInsight === null || llmInsight === void 0 ? void 0 : llmInsight.confidence) || confidence,
                fixes,
                llmInsight
            });
        }
        return rootCauses;
    }
    // Generate detailed fix suggestions for a root cause using LLM
    async generateFixSuggestions(rootCause) {
        if (!rootCause.llmInsight) {
            console.log("No LLM insight available for generating fixes");
            return rootCause.fixes.map(fix => ({
                description: fix,
                code: "// No specific code suggestion available",
                impact: "Unknown",
                confidence: 0.5
            }));
        }
        try {
            // Find code context
            let codeContext = "";
            if (this.codeAnalyzer) {
                const nodes = Array.from(this.codeAnalyzer.getNodes().values());
                for (const node of nodes) {
                    if (node.variables.some(v => v.name === rootCause.variable)) {
                        codeContext = this.codeAnalyzer.getCodeSnippet(node.id);
                        break;
                    }
                }
            }
            if (!codeContext) {
                return rootCause.fixes.map(fix => ({
                    description: fix,
                    code: "// No specific code suggestion available",
                    impact: "Unknown",
                    confidence: 0.5
                }));
            }
            // Build execution context
            const series = this.dataCollector.getDataSeries(rootCause.breakpointId);
            let executionContext = `Variable ${rootCause.variable} shows anomalous behavior.`;
            if (series) {
                executionContext += ` Last observed values: ${series.data.slice(-3).map(d => {
                    const varValue = d.variables.find(v => v.name === rootCause.variable);
                    return varValue ? varValue.value : 'unknown';
                }).join(', ')}`;
            }
            // Get detailed fix suggestions from LLM
            return await this.llmService.suggestFixes(rootCause.llmInsight.description, codeContext, executionContext);
        }
        catch (error) {
            console.error("Error generating fix suggestions:", error);
            return rootCause.fixes.map(fix => ({
                description: fix,
                code: "// Error generating code suggestion",
                impact: "Unknown",
                confidence: 0.3
            }));
        }
    }
}
exports.CausalAnalysis = CausalAnalysis;
//# sourceMappingURL=causalAnalysis.js.map