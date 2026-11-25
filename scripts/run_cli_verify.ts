import fs from 'node:fs';
import path from 'node:path';
import {
  gridSearchBestStaticTimetable,
  runScenarioComparison,
  runSensitivitySuite,
} from '../src/sim/analytics';
import { DEFAULT_CONFIG } from '../src/sim/types';
import { runFullVerificationSuite } from '../src/sim/verification';

const tests = runFullVerificationSuite();
const failed = tests.filter((t) => !t.passed);
console.log(`Verification tests: ${tests.length - failed.length}/${tests.length} passed`);
for (const t of tests) {
  console.log(`[${t.passed ? 'PASS' : 'FAIL'}] ${t.id} ${t.name} -> ${t.assertionDetail}`);
}
if (failed.length > 0) process.exit(1);

console.log('\nRunning Grid Search for Best-Tuned Static Timetable...');
const gs = gridSearchBestStaticTimetable(DEFAULT_CONFIG);
console.log('Best Static Schedule:', gs.bestSchedule, 'Avg Wait:', gs.topCandidates[0].avgWaitTime);
console.log('Top 5 Grid Search Candidates:', gs.topCandidates.slice(0, 5));

const calibratedConfig = {
  ...DEFAULT_CONFIG,
  bestStaticSchedule: gs.bestSchedule,
  replications: 30,
};

console.log('\nRunning 30-Replication CRN Scenario Comparison...');
const scenarios = runScenarioComparison(calibratedConfig);
for (const s of scenarios) {
  console.log(
    `${s.shortName}: avgWait=${s.metrics.avgWaitTime.mean}m (diff vs BestStatic=${s.metrics.avgWaitTime.pairedDiffMean}m [${s.metrics.avgWaitTime.pairedDiffCi95Low}, ${s.metrics.avgWaitTime.pairedDiffCi95High}], imp=${s.metrics.avgWaitTime.improvementVsBestStaticPct}%, dz=${s.metrics.avgWaitTime.cohensDz}), P95=${s.metrics.p95WaitTime.mean}m, >10m=${s.metrics.pctWaitingOver10Min.mean}%, unserved=${s.metrics.unservedAtClose.mean}, J=${s.metrics.objectiveJ.mean}`
  );
}

console.log('\nRunning Sensitivity & Fleet Sweep (c=4..14)...');
const sensitivity = runSensitivitySuite(calibratedConfig);
console.log('Min Fleet for SLA (avg<=5m, P95<=15m):', sensitivity.minFleetForSLA);
console.log('Fleet Sweep:');
for (const fp of sensitivity.fleetSweep) {
  console.log(
    `  c=${fp.fleetSize}: BestStatic=${fp.bestStaticAvgWait}m (P95=${fp.bestStaticP95Wait}m, SLA=${fp.bestStaticMeetsSLA}) | Combined=${fp.combinedAvgWait}m (P95=${fp.combinedP95Wait}m, SLA=${fp.combinedMeetsSLA})`
  );
}
console.log('Demand Sweep (0.8x..1.6x):', sensitivity.demandSweep);
console.log('Traffic Sweep (0.0x..2.0x):', sensitivity.trafficSweep);
console.log('Sudden Surge:', sensitivity.surgeComparison);

const outDir = path.resolve('muet-transit-intelligence/results/metrics');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'experiment_results.json'),
  JSON.stringify(
    {
      config: calibratedConfig,
      gridSearchTop: gs.topCandidates,
      scenarios: scenarios.map((s) => ({
        policy: s.policy,
        label: s.label,
        shortName: s.shortName,
        replications: s.replications,
        metrics: s.metrics,
      })),
      sensitivity,
      verification: tests,
    },
    null,
    2
  )
);
