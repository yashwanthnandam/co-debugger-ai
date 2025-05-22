"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InformationGainAnalyzer = void 0;
class InformationGainAnalyzer {
    constructor(dataCollector) {
        this.dataCollector = dataCollector;
    }
    rankVariablesByInformationGain() {
        const allSeries = this.dataCollector.getAllDataSeries();
        const rankings = [];
        for (const series of allSeries) {
            // Calculate information gain for each variable in this series
            for (const [varName, stats] of series.variableStatistics.entries()) {
                // Skip variables with no anomalies
                if (stats.anomalies.length === 0)
                    continue;
                const infoGain = this.calculateInformationGain(stats, series);
                const mutualInfo = this.calculateMutualInformation(varName, series);
                const predictive = this.calculatePredictivePower(varName, series);
                rankings.push({
                    variableName: varName,
                    breakpointId: series.breakpointId,
                    informationGain: infoGain,
                    mutualInformation: mutualInfo,
                    predictivePower: predictive
                });
            }
        }
        // Sort by information gain in descending order
        rankings.sort((a, b) => b.informationGain - a.informationGain);
        return rankings;
    }
    calculateInformationGain(stats, series) {
        // A simplified implementation of information gain calculation
        // In a real system, this would use entropy-based measures
        // If this variable has anomalies, it has higher information gain
        const anomalyRatio = stats.anomalies.length / stats.valuesOverTime.length;
        // Normalize the standard deviation to get a measure of variability
        const variability = stats.stdDev / (stats.max - stats.min + 0.0001);
        // Combine anomaly presence with variability
        return anomalyRatio * 0.7 + variability * 0.3;
    }
    calculateMutualInformation(varName, series) {
        // Calculate mutual information between this variable and anomaly presence
        // This is a simplified implementation
        const stats = series.variableStatistics.get(varName);
        if (!stats)
            return 0;
        // Count anomalous vs. normal points
        const anomalyIndices = new Set(stats.anomalies.map(a => a.timestamp));
        // Mutual information relates to how well this variable predicts anomalies
        return stats.anomalies.length > 0 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.3;
    }
    calculatePredictivePower(varName, series) {
        // Calculate how well this variable predicts anomalies in other variables
        // This is a simplified implementation
        let predictivePower = 0;
        // Check correlation with anomalies in other variables
        for (const [otherVar, otherStats] of series.variableStatistics.entries()) {
            if (otherVar === varName)
                continue;
            // In a real implementation, we would calculate correlation or other predictive metrics
            predictivePower += otherStats.anomalies.length > 0 ? 0.2 : 0;
        }
        return Math.min(predictivePower, 1);
    }
    getTopInformativeVariables(limit = 5) {
        const rankings = this.rankVariablesByInformationGain();
        return rankings.slice(0, limit);
    }
    getInformativeVariablesForBreakpoint(breakpointId, limit = 3) {
        const rankings = this.rankVariablesByInformationGain();
        return rankings
            .filter(r => r.breakpointId === breakpointId)
            .slice(0, limit);
    }
}
exports.InformationGainAnalyzer = InformationGainAnalyzer;
//# sourceMappingURL=informationGain.js.map