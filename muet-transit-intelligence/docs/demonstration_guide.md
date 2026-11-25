# MUET Transit Intelligence — Panel Demonstration Guide

1. **Problem Framing (2 min)**: Open *Executive Overview* and *IEEE Report & Repo → Data Provenance*. Emphasize that we distinguish verified MUET peak windows (08:00–09:00, 14:00–15:30) from synthetic configurable parameters (`c=10`, `K=50`).
2. **Expose the Baseline Bottleneck (2 min)**: Open *Live Simulation*, select **Static Baseline**, and scrub to `14:45`. Point out STC queue overflow and idle counter-terminal buses.
3. **Demonstrate Adaptive Optimization (2 min)**: Switch policy to **Combined Optimizer** and watch proactive empty repositioning and adaptive headway compression clear the queue.
4. **Statistical & Mathematical Defense (3 min)**: Walk through *Scenario Comparison* (10 CRN replications, 95% Student-t CIs showing 85.9% wait reduction), *Performance Analytics* sensitivity curves, and *Math, Diagrams & Tests* (11/11 passing invariants and M/M/c limitation proof).
