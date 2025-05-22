import { DataCollector, VariableStatistics, DataSeries } from './dataCollector';

export interface VariableRanking {
    variableName: string;
    breakpointId: string;
    informationGain: number;
    mutualInformation: number;
    predictivePower: number;
}

export class InformationGainAnalyzer {
    private dataCollector: DataCollector;
    
    constructor(dataCollector: DataCollector) {
        this.dataCollector = dataCollector;
    }
    
    public rankVariablesByInformationGain(): VariableRanking[] {
        const allSeries = this.dataCollector.getAllDataSeries();
        const rankings: VariableRanking[] = [];
        
        for (const series of allSeries) {
            // Calculate information gain for each variable in this series
            for (const [varName, stats] of series.variableStatistics.entries()) {
                // Skip variables with no anomalies
                if (stats.anomalies.length === 0) continue;
                
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
    
    private calculateInformationGain(stats: VariableStatistics, series: DataSeries): number {
        // A simplified implementation of information gain calculation
        // In a real system, this would use entropy-based measures
        
        // If this variable has anomalies, it has higher information gain
        const anomalyRatio = stats.anomalies.length / stats.valuesOverTime.length;
        
        // Normalize the standard deviation to get a measure of variability
        const variability = stats.stdDev / (stats.max - stats.min + 0.0001);
        
        // Combine anomaly presence with variability
        return anomalyRatio * 0.7 + variability * 0.3;
    }
    
    private calculateMutualInformation(varName: string, series: DataSeries): number {
        // Calculate mutual information between this variable and anomaly presence
        // This is a simplified implementation
        
        const stats = series.variableStatistics.get(varName);
        if (!stats) return 0;
        
        // Count anomalous vs. normal points
        const anomalyIndices = new Set(stats.anomalies.map(a => a.timestamp));
        
        // Mutual information relates to how well this variable predicts anomalies
        return stats.anomalies.length > 0 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.3;
    }
    
    private calculatePredictivePower(varName: string, series: DataSeries): number {
        // Calculate how well this variable predicts anomalies in other variables
        // This is a simplified implementation
        
        let predictivePower = 0;
        
        // Check correlation with anomalies in other variables
        for (const [otherVar, otherStats] of series.variableStatistics.entries()) {
            if (otherVar === varName) continue;
            
            // In a real implementation, we would calculate correlation or other predictive metrics
            predictivePower += otherStats.anomalies.length > 0 ? 0.2 : 0;
        }
        
        return Math.min(predictivePower, 1);
    }
    
    public getTopInformativeVariables(limit: number = 5): VariableRanking[] {
        const rankings = this.rankVariablesByInformationGain();
        return rankings.slice(0, limit);
    }
    
    public getInformativeVariablesForBreakpoint(breakpointId: string, limit: number = 3): VariableRanking[] {
        const rankings = this.rankVariablesByInformationGain();
        return rankings
            .filter(r => r.breakpointId === breakpointId)
            .slice(0, limit);
    }
}