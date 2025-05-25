import * as vscode from 'vscode';
import { LLMService, AnomalyExplanation } from './llmService';

export interface VariableValue {
    name: string;
    value: any;
    type: string;
    timestamp: number;
}

export interface DataPoint {
    breakpointId: string;
    timestamp: number;
    variables: VariableValue[];
    callStack: string[];
    iterationCount: number;
    output?: string;
    anomalyScore?: number;
    anomalyDetails?: {
        explanation?: AnomalyExplanation;
        detectedVariables: string[];
    };
}

export interface DataSeries {
    breakpointId: string;
    nodeId: string;
    data: DataPoint[];
    baselineData?: DataPoint[];
    variableStatistics: Map<string, VariableStatistics>;
}

export interface VariableStatistics {
    name: string;
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    valuesOverTime: any[];
    anomalies: AnomalyPoint[];
}

export interface AnomalyPoint {
    timestamp: number;
    value: any;
    expectedRange: [number, number];
    deviation: number;
}

export class DataCollector {
    private breakpointData: Map<string, DataSeries> = new Map();
    private currentIteration: Map<string, number> = new Map();
    private baselineMode: boolean = false;
    private llmService: LLMService;
    private codeSnippets: Map<string, string> = new Map();
    
    constructor(llmService?: LLMService) {
        this.llmService = llmService || new LLMService();
    }
    
    public setCodeSnippet(nodeId: string, snippet: string): void {
        this.codeSnippets.set(nodeId, snippet);
    }
    
    public async collectData(
        breakpointId: string, 
        nodeId: string, 
        variables: any, 
        stackTrace: string[]
    ): Promise<DataPoint> {
        const iterationCount = (this.currentIteration.get(breakpointId) || 0) + 1;
        this.currentIteration.set(breakpointId, iterationCount);
        
        const variableValues: VariableValue[] = [];
        for (const [name, value] of Object.entries(variables)) {
            variableValues.push({
                name,
                value,
                type: typeof value,
                timestamp: Date.now()
            });
        }
        
        const dataPoint: DataPoint = {
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
        
        if (!this.breakpointData.has(breakpointId)) {
            this.breakpointData.set(breakpointId, {
                breakpointId,
                nodeId,
                data: [],
                variableStatistics: new Map()
            });
        }
        
        const series = this.breakpointData.get(breakpointId)!;
        
        if (this.baselineMode) {
            if (!series.baselineData) {
                series.baselineData = [];
            }
            series.baselineData.push(dataPoint);
        } else {
            series.data.push(dataPoint);
        }
        
        this.updateStatistics(series, dataPoint);
        
        if (series.baselineData && series.baselineData.length > 0) {
            dataPoint.anomalyScore = this.calculateAnomalyScore(dataPoint, series);
            if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.5) {
                await this.explainAnomalyWithLLM(dataPoint, series, nodeId);
            }
        } else if (series.data.length > 2) {
            dataPoint.anomalyScore = this.calculateAnomalyFromHistory(dataPoint, series);
            if (dataPoint.anomalyScore && dataPoint.anomalyScore > 1.8) {
                await this.explainAnomalyWithLLM(dataPoint, series, nodeId);
            }
        }
        
        return dataPoint;
    }

    private async explainAnomalyWithLLM(
        dataPoint: DataPoint, 
        series: DataSeries, 
        nodeId: string
    ): Promise<void> {
        try {
            const codeSnippet = this.codeSnippets.get(nodeId) || "";
            if (!codeSnippet) {
                console.warn("No code snippet available for anomaly explanation at node:", nodeId);
                return;
            }
            
            const executionContext = `Current call stack: ${dataPoint.callStack.join(" -> ")}`;
            const anomalousVars: string[] = [];
            let anomalyDescription = "Unusual variable values detected: ";
            const variableValues: Record<string, any> = {};
            
            for (const variable of dataPoint.variables) {
                variableValues[variable.name] = variable.value;
                const stats = series.variableStatistics.get(variable.name);
                if (stats && stats.anomalies.length > 0) {
                    const latestAnomaly = stats.anomalies[stats.anomalies.length - 1];
                    if (latestAnomaly.timestamp === dataPoint.timestamp) {
                        anomalousVars.push(variable.name);
                        anomalyDescription += `${variable.name}=${variable.value} (expected range: ${latestAnomaly.expectedRange[0].toFixed(2)}-${latestAnomaly.expectedRange[1].toFixed(2)}), `;
                    }
                }
            }
            
            if (anomalousVars.length === 0) {
                anomalyDescription = "Unusual program behavior detected at this point.";
            } else {
                anomalyDescription = anomalyDescription.slice(0, -2);
                dataPoint.anomalyDetails!.detectedVariables = anomalousVars;
            }
            
            const explanation = await this.llmService.explainAnomaly(
                codeSnippet,
                variableValues,
                anomalyDescription,
                executionContext
            );
            
            dataPoint.anomalyDetails!.explanation = explanation;
            
        } catch (error) {
            console.error("Error getting LLM explanation for anomaly:", error);
        }
    }
    
    private updateStatistics(series: DataSeries, dataPoint: DataPoint): void {
        for (const variable of dataPoint.variables) {
            if (typeof variable.value === 'number') {
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
                } else {
                    const stats = series.variableStatistics.get(variable.name)!;
                    stats.valuesOverTime.push(variable.value);
                    stats.min = Math.min(stats.min, variable.value);
                    stats.max = Math.max(stats.max, variable.value);
                    const sum = stats.valuesOverTime.reduce((acc, val) => acc + val, 0);
                    stats.mean = sum / stats.valuesOverTime.length;
                    const sorted = [...stats.valuesOverTime].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    stats.median = sorted.length % 2 === 0
                        ? (sorted[mid - 1] + sorted[mid]) / 2
                        : sorted[mid];
                    const squareDiffs = stats.valuesOverTime.map(value => {
                        const diff = value - stats.mean;
                        return diff * diff;
                    });
                    const avgSquareDiff = squareDiffs.reduce((acc, val) => acc + val, 0) / squareDiffs.length;
                    stats.stdDev = Math.sqrt(avgSquareDiff);
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
    
    private calculateAnomalyScore(dataPoint: DataPoint, series: DataSeries): number {
        let totalDeviation = 0;
        let count = 0;
        for (const variable of dataPoint.variables) {
            if (typeof variable.value === 'number' && series.variableStatistics.has(variable.name)) {
                const stats = series.variableStatistics.get(variable.name)!;
                if (stats.stdDev > 0) {
                    const deviation = Math.abs((variable.value - stats.mean) / stats.stdDev);
                    const importance = 1 + (stats.anomalies.length * 0.2);
                    totalDeviation += deviation * importance;
                    count += importance;
                }
            }
        }
        return count > 0 ? totalDeviation / count : 0;
    }
    
    private calculateAnomalyFromHistory(dataPoint: DataPoint, series: DataSeries): number {
        let anomalyScore = 0;
        if (series.data.length < 3) {
            return 0;
        }
        for (const variable of dataPoint.variables) {
            if (typeof variable.value !== 'number') continue;
            const stats = series.variableStatistics.get(variable.name);
            if (!stats || stats.valuesOverTime.length < 3) continue;
            if (stats.stdDev > 0) {
                const zScore = Math.abs((variable.value - stats.mean) / stats.stdDev);
                if (zScore > 2.5) {
                    anomalyScore += zScore - 2;
                }
                const recentValues = stats.valuesOverTime.slice(-3);
                if (recentValues.length === 3) {
                    const trend1 = recentValues[1] - recentValues[0];
                    const trend2 = variable.value - recentValues[2];
                    if (Math.sign(trend1) !== Math.sign(trend2)) {
                        const trendBreakScore = Math.min(2, Math.abs(trend2) / (Math.abs(trend1) + 0.0001));
                        anomalyScore += trendBreakScore;
                    }
                }
            }
        }
        return anomalyScore;
    }
    
    public setBaselineMode(enabled: boolean): void {
        this.baselineMode = enabled;
    }
    
    public getDataSeries(breakpointId: string): DataSeries | undefined {
        return this.breakpointData.get(breakpointId);
    }
    
    public getAllDataSeries(): DataSeries[] {
        return Array.from(this.breakpointData.values());
    }
    
    public getVariableStatistics(breakpointId: string, variableName: string): VariableStatistics | undefined {
        const series = this.breakpointData.get(breakpointId);
        if (!series) return undefined;
        return series.variableStatistics.get(variableName);
    }
    
    public getAnomalies(breakpointId: string): Map<string, AnomalyPoint[]> {
        const result = new Map<string, AnomalyPoint[]>();
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
    
    public getRecentAnomalyExplanations(count: number = 5): {
        breakpointId: string;
        timestamp: number;
        explanation: AnomalyExplanation;
    }[] {
        const explanations: {
            breakpointId: string;
            timestamp: number;
            explanation: AnomalyExplanation;
        }[] = [];
        for (const series of this.breakpointData.values()) {
            for (const point of series.data) {
                if (point.anomalyDetails?.explanation) {
                    explanations.push({
                        breakpointId: point.breakpointId,
                        timestamp: point.timestamp,
                        explanation: point.anomalyDetails.explanation
                    });
                }
            }
        }
        return explanations
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }
    
    public clearData(): void {
        this.breakpointData.clear();
        this.currentIteration.clear();
    }
}
