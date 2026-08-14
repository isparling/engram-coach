import * as fs from 'fs';
import * as YAML from 'yaml';
import { SpotTestOrder } from '../types';

export interface PrescriptionSession {
  week: number;
  day: string;
  session_date: string;
  session_name: string;
  intervals?: IntervalBlock[];
  spot_tests?: SpotTestOrderYAML[];
}

export interface IntervalBlock {
  duration_min: number;
  power_low_pct: number;
  power_high_pct: number;
  count: number;
  recovery_min: number;
}

export interface SpotTestOrderYAML {
  interval_ref: number;
  sample_times_min: number[];
  reason?: string;
}

export interface PrescriptionDocument {
  block_name: string;
  goal?: { event?: string; date?: string; description?: string };
  sessions: PrescriptionSession[];
}

export class SpotTestParser {
  parsePrescriptionFile(filePath: string): PrescriptionDocument | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parsePrescriptionContent(content);
    } catch (error) {
      console.error(`Error reading prescription file: ${error}`);
      return null;
    }
  }

  parsePrescriptionContent(content: string): PrescriptionDocument | null {
    try {
      return YAML.parse(content) as PrescriptionDocument;
    } catch (error) {
      console.error(`Error parsing YAML: ${error}`);
      return null;
    }
  }

  extractSpotTestOrders(doc: PrescriptionDocument): SpotTestOrder[] {
    const orders: SpotTestOrder[] = [];

    for (const session of doc.sessions) {
      if (session.spot_tests && session.spot_tests.length > 0) {
        for (const spotTest of session.spot_tests) {
          orders.push({
            sessionName: session.session_name,
            intervalRef: spotTest.interval_ref,
            sampleTimesMin: spotTest.sample_times_min,
            reason: spotTest.reason || 'Coach ordered spot test',
            orderedAt: session.session_date
          });
        }
      }
    }

    return orders;
  }

  findSessionsWithSpotTests(doc: PrescriptionDocument): PrescriptionSession[] {
    return doc.sessions.filter(session => 
      session.spot_tests && session.spot_tests.length > 0
    );
  }

  getSpotTestForSession(doc: PrescriptionDocument, sessionName: string): SpotTestOrder[] {
    const session = doc.sessions.find(s => s.session_name === sessionName);
    if (!session?.spot_tests) return [];

    return session.spot_tests.map(st => ({
      sessionName,
      intervalRef: st.interval_ref,
      sampleTimesMin: st.sample_times_min,
      reason: st.reason || 'Coach ordered spot test',
      orderedAt: session.session_date
    }));
  }

  formatSpotTestInstructions(order: SpotTestOrder, session: PrescriptionSession): string {
    const intervalInfo = session.intervals?.[order.intervalRef - 1];
    
    let instructions = `# Spot Test Order\n\n`;
    instructions += `**Session:** ${order.sessionName}\n`;
    instructions += `**Date:** ${order.orderedAt}\n`;
    instructions += `**Reason:** ${order.reason}\n\n`;
    instructions += `## Sampling Instructions\n\n`;
    
    for (const timeMin of order.sampleTimesMin) {
      instructions += `- Take lactate sample at t=${timeMin}min\n`;
    }
    
    if (intervalInfo) {
      instructions += `\n## Interval Context\n\n`;
      instructions += `Interval #${order.intervalRef}:\n`;
      instructions += `- Duration: ${intervalInfo.duration_min}min\n`;
      instructions += `- Power: ${intervalInfo.power_low_pct}-${intervalInfo.power_high_pct}% FTP\n`;
      instructions += `- Recovery: ${intervalInfo.recovery_min}min after\n`;
    }
    
    return instructions;
  }
}

export function createParser(): SpotTestParser {
  return new SpotTestParser();
}
