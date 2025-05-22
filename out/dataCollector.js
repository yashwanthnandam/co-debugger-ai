"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataCollector = void 0;
const llmService_1 = require("./llmService");
class DataCollector {
    constructor(llmService) {
        this.breakpointData = new Map();
        this.currentIteration = new Map();
        this.baselineMode = false;
        this.codeSnippets = new Map(); // Store code snippets for context
        // Initialize data structures
        this.llmService = llmService || new llmService_1.LLMService();
    }
    // Set code snippet for context
    setCodeSnippet(nodeId, snippet) {
        this.codeSnippets.set(nodeId, snippet);
    }
    // Called when a breakpoint is hit
    async collectData(breakpointId, nodeId, variables, stackTrace) {
        // Increment the iteration counter for this breakpoint
        const iterationCount = (this.currentIteration.get(breakpointId) || 0) + 1;
        this.currentIteration.set(breakpointId, iterationCount);
        // Extract variable values
        const variableValues = [];
        for (const [name, value] of Object.entries(variables)) {
            variableValues.push({
                name,
                value,
                type: typeof value,
                timestamp: Date.now()
            });
        }
        // Create a data point
        const dataPoint = {
            breakpointId,
            timestamp: Date.now(),
            variables: variableValues,
            callStack: stackTrace,
            iterationCount,
            output: '',
            anomalyDetails: {
                detectedVariables: []
            }
        };
        // Store the data point
        if (!this.breakpointData.has(breakpointId)) {
            this.breakpointData.set(breakpointId, {
                breakpointId,
                nodeId,
                data: [],
                variableStatistics: new Map()
            });
        }
        const series = this.breakpointData.get(breakpointId);
        if (this.baselineMode) {
            // In baseline mode, store as reference data
            if (!series.baselineData) {
                series.baselineData = [];
            }
            series.baselineData.push(dataPoint);
        }
        else {
            // Normal mode
            series.data.push(dataPoint);
        }
        // Update statistics for each variable
        this.updateStatistics(series, dataPoint);
        // Calculate anomaly score if we have baseline data
        if (series.baselineData && series.baselineData.length > 0) {
            dataPoint.anomalyScore = this.calculateAnomalyScore(dataPoint, series);
            // If anomaly detected, get AI explanation
            if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.5) {
                await this.explainAnomalyWithLLM(dataPoint, series, nodeId);
            }
        }
        else if (series.data.length > 2) {
            // If no baseline, still try to detect anomalies based on past runs
            dataPoint.anomalyScore = this.calculateAnomalyFromHistory(dataPoint, series);
            // If anomaly detected without baseline, get AI explanation
            if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.8) {
                await this.explainAnomalyWithLLM(dataPoint, series, nodeId);
            }
        }
        return dataPoint;
    }
    async explainAnomalyWithLLM(dataPoint, series, nodeId) {
        try {
            // Get code snippet for context
            const codeSnippet = this.codeSnippets.get(nodeId) || "";
            if (!codeSnippet) {
                console.warn("No code snippet available for anomaly explanation at node:", nodeId);
                return;
            }
            // Build execution context from call stack
            const executionContext = `Current call stack: ${dataPoint.callStack.join(" -> ")}`;
            // Find which variables are anomalous
            const anomalousVars = [];
            let anomalyDescription = "Unusual variable values detected: ";
            // Create a clean variable values object for LLM
            const variableValues = {};
            for (const variable of dataPoint.variables) {
                variableValues[variable.name] = variable.value;
                // Check if this variable has anomalies
                const stats = series.variableStatistics.get(variable.name);
                if (stats && stats.anomalies.length > 0) {
                    // Check if the latest value is anomalous
                    const latestAnomaly = stats.anomalies[stats.anomalies.length - 1];
                    if (latestAnomaly.timestamp === dataPoint.timestamp) {
                        anomalousVars.push(variable.name);
                        anomalyDescription += `${variable.name}=${variable.value} (expected range: ${latestAnomaly.expectedRange[0].toFixed(2)}-${latestAnomaly.expectedRange[1].toFixed(2)}), `;
                    }
                }
            }
            if (anomalousVars.length === 0) {
                // If no specific variable anomalies detected but overall score is high
                anomalyDescription = "Unusual program behavior detected at this point.";
            }
            else {
                // Trim the trailing comma and space
                anomalyDescription = anomalyDescription.slice(0, -2);
                dataPoint.anomalyDetails.detectedVariables = anomalousVars;
            }
            // Get LLM explanation
            const explanation = await this.llmService.explainAnomaly(codeSnippet, variableValues, anomalyDescription, executionContext);
            // Store the explanation
            dataPoint.anomalyDetails.explanation = explanation;
        }
        catch (error) {
            console.error("Error getting LLM explanation for anomaly:", error);
        }
    }
    updateStatistics(series, dataPoint) {
        // Update the statistics for each variable
        for (const variable of dataPoint.variables) {
            if (typeof variable.value === 'number') {
                // Only calculate statistics for numeric variables
                if (!series.variableStatistics.has(variable.name)) {
                    series.variableStatistics.set(variable.name, {
                        name: variable.name,
                        mean: variable.value,
                        median: variable.value,
                        stdDev: 0,
                        min: variable.value,
                        max: variable.value,
                        valuesOverTime: [variable.value],
                        anomalies: []
                    });
                }
                else {
                    const stats = series.variableStatistics.get(variable.name);
                    // Add this value to the history
                    stats.valuesOverTime.push(variable.value);
                    // Update min/max
                    stats.min = Math.min(stats.min, variable.value);
                    stats.max = Math.max(stats.max, variable.value);
                    // Recalculate mean
                    const sum = stats.valuesOverTime.reduce((acc, val) => acc + val, 0);
                    stats.mean = sum / stats.valuesOverTime.length;
                    // Recalculate median
                    const sorted = [...stats.valuesOverTime].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    stats.median = sorted.length % 2 === 0
                        ? (sorted[mid - 1] + sorted[mid]) / 2
                        : sorted[mid];
                    // Recalculate standard deviation
                    const squareDiffs = stats.valuesOverTime.map(value => {
                        const diff = value - stats.mean;
                        return diff * diff;
                    });
                    const avgSquareDiff = squareDiffs.reduce((acc, val) => acc + val, 0) / squareDiffs.length;
                    stats.stdDev = Math.sqrt(avgSquareDiff);
                    // Check for anomalies - more sensitive with more data points
                    const deviationThreshold = Math.max(1.5, 3 - 0.1 * Math.min(stats.valuesOverTime.length, 15));
                    const lowerBound = stats.mean - deviationThreshold * stats.stdDev;
                    const upperBound = stats.mean + deviationThreshold * stats.stdDev;
                    if (variable.value < lowerBound || variable.value > upperBound) {
                        stats.anomalies.push({
                            timestamp: variable.timestamp,
                            value: variable.value,
                            expectedRange: [lowerBound, upperBound],
                            deviation: Math.abs((variable.value - stats.mean) / stats.stdDev)
                        });
                    }
                }
            }
        }
    }
    calculateAnomalyScore(dataPoint, series) {
        // Calculate an overall anomaly score based on deviation from baseline
        let totalDeviation = 0;
        let count = 0;
        // Compare each variable with baseline statistics
        for (const variable of dataPoint.variables) {
            if (typeof variable.value === 'number' && series.variableStatistics.has(variable.name)) {
                const stats = series.variableStatistics.get(variable.name);
                if (stats.stdDev > 0) {
                    const deviation = Math.abs((variable.value - stats.mean) / stats.stdDev);
                    // Weight deviation by importance of the variable
                    // Variables with history of anomalies are more important
                    const importance = 1 + (stats.anomalies.length * 0.2);
                    totalDeviation += deviation * importance;
                    count += importance;
                }
            }
        }
        return count > 0 ? totalDeviation / count : 0;
    }
    calculateAnomalyFromHistory(dataPoint, series) {
        // Detect anomalies based on historical execution without baseline
        // Uses a more dynamic approach with trend analysis
        let anomalyScore = 0;
        // Need at least a few data points to detect anomalies
        if (series.data.length < 3) {
            return 0;
        }
        for (const variable of dataPoint.variables) {
            if (typeof variable.value !== 'number')
                continue;
            const stats = series.variableStatistics.get(variable.name);
            if (!stats || stats.valuesOverTime.length < 3)
                continue;
            // Check for sudden changes using z-score
            if (stats.stdDev > 0) {
                const zScore = Math.abs((variable.value - stats.mean) / stats.stdDev);
                // Higher threshold when no baseline (more conservative)
                if (zScore > 2.5) {
                    anomalyScore += zScore - 2; // Count only excess over threshold
                }
                // Check for trend breaks
                const recentValues = stats.valuesOverTime.slice(-3);
                if (recentValues.length === 3) {
                    const trend1 = recentValues[1] - recentValues[0];
                    const trend2 = variable.value - recentValues[2];
                    // If trend suddenly changes direction
                    if (Math.sign(trend1) !== Math.sign(trend2)) {
                        const trendBreakScore = Math.min(2, Math.abs(trend2) / (Math.abs(trend1) + 0.0001));
                        anomalyScore += trendBreakScore;
                    }
                }
            }
        }
        return anomalyScore;
    }
    setBaselineMode(enabled) {
        this.baselineMode = enabled;
    }
    getDataSeries(breakpointId) {
        return this.breakpointData.get(breakpointId);
    }
    getAllDataSeries() {
        return Array.from(this.breakpointData.values());
    }
    getVariableStatistics(breakpointId, variableName) {
        const series = this.breakpointData.get(breakpointId);
        if (!series)
            return undefined;
        return series.variableStatistics.get(variableName);
    }
    getAnomalies(breakpointId) {
        const result = new Map();
        const series = this.breakpointData.get(breakpointId);
        if (series) {
            for (const [varName, stats] of series.variableStatistics.entries()) {
                if (stats.anomalies.length > 0) {
                    result.set(varName, stats.anomalies);
                }
            }
        }
        return result;
    }
    getRecentAnomalyExplanations(count = 5) {
        var _a;
        const explanations = [];
        // Collect all explanations from all data points
        for (const series of this.breakpointData.values()) {
            for (const point of series.data) {
                if ((_a = point.anomalyDetails) === null || _a === void 0 ? void 0 : _a.explanation) {
                    explanations.push({
                        breakpointId: point.breakpointId,
                        timestamp: point.timestamp,
                        explanation: point.anomalyDetails.explanation
                    });
                }
            }
        }
        // Sort by timestamp (most recent first) and take the top N
        return explanations
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }
    clearData() {
        this.breakpointData.clear();
        this.currentIteration.clear();
    }
}
exports.DataCollector = DataCollector;
//# sourceMappingURL=dataCollector.js.map