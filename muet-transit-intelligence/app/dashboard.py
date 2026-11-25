"""MUET Transit Intelligence — [OPTIONAL SECONDARY UI] Streamlit & Plotly Dashboard.

Note: The primary interactive dashboard and IEEE publication report are served
by the React/TypeScript web application at the repository root. This file is
retained as an optional secondary Python/Streamlit prototype.
"""

import streamlit as st
import plotly.graph_objects as go

from experiments.run_experiments import run_all_scenarios
from simulation.engine import SimConfig


st.set_page_config(
    page_title="MUET Transit Intelligence (Optional Secondary Streamlit UI)",
    layout="wide",
)

st.markdown(
    """
    <style>
    .stApp { background-color: #080C1A; color: #F1F5F9; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("MUET Transit Intelligence — Optional Secondary Streamlit UI")
st.caption("Primary application runs in React/TypeScript at repo root · 30-Replication Paired CRN Engine")

with st.sidebar:
    st.header("Scenario Configuration")
    fleet_size = st.slider("Fleet Size (c buses)", 4, 14, 10)
    bus_capacity = st.slider("Bus Capacity (K pax)", 25, 75, 50, step=5)
    arrival_mult = st.slider("Arrival Multiplier", 0.8, 1.6, 1.0, step=0.1)
    traffic_sev = st.slider("Traffic Severity", 0.0, 2.0, 1.0, step=0.1)
    replications = st.number_input("CRN Replications", min_value=5, max_value=30, value=30)
    seed = st.number_input("Random Seed", min_value=1, max_value=999999, value=42)
    surge = st.checkbox("Sudden Unscheduled Surge (+120 pax)", value=False)

cfg = SimConfig(
    fleet_size=fleet_size,
    bus_capacity=bus_capacity,
    arrival_multiplier=arrival_mult,
    traffic_severity=traffic_sev,
    seed=int(seed),
    sudden_surge_enabled=surge,
)

results = run_all_scenarios(cfg, replications=int(replications))
best_static = results["BASELINE_BEST_STATIC"]
comb = results["COMBINED"]

c1, c2, c3, c4 = st.columns(4)
c1.metric(
    "Avg Wait (Combined)",
    f"{comb['avg_wait_time']['mean']} min",
    f"{comb['avg_wait_time']['mean'] - best_static['avg_wait_time']['mean']:.2f} min vs Best Static",
)
c2.metric(
    "P95 Tail Wait",
    f"{comb['p95_wait_time']['mean']} min",
    f"{comb['p95_wait_time']['mean'] - best_static['p95_wait_time']['mean']:.2f} min",
)
c3.metric(
    "Waiting > 10 Min",
    f"{comb['pct_waiting_over_10']['mean']:.2f}%",
    f"{comb['pct_waiting_over_10']['mean'] - best_static['pct_waiting_over_10']['mean']:.2f}%",
)
c4.metric(
    "Unserved at Close",
    f"{comb['unserved_at_close']['mean']:.1f} pax",
    f"{comb['unserved_at_close']['mean'] - best_static['unserved_at_close']['mean']:.1f} pax",
)

policies = [
    "BASELINE_CURRENT",
    "BASELINE_BEST_STATIC",
    "QUEUE_AWARE",
    "ADAPTIVE_HEADWAY",
    "COMBINED",
]
fig = go.Figure(
    data=[
        go.Bar(
            name="Mean Wait (min)",
            x=policies,
            y=[results[p]["avg_wait_time"]["mean"] for p in policies],
        ),
        go.Bar(
            name="P95 Wait (min)",
            x=policies,
            y=[results[p]["p95_wait_time"]["mean"] for p in policies],
        ),
    ]
)
fig.update_layout(
    barmode="group",
    template="plotly_dark",
    paper_bgcolor="#0F162E",
    plot_bgcolor="#0F162E",
    title="Dual-Baseline Waiting Time Comparison (min)",
)
st.plotly_chart(fig, use_container_width=True)
