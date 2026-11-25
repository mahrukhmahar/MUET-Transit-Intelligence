"""Zero-Dependency Pure-Python Two-Column IEEE PDF 1.4 Compiler with Vector Figures."""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple


def _esc(text: str) -> str:
    ascii_safe = "".join(c if 32 <= ord(c) <= 126 else "-" for c in text)
    return ascii_safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PdfDocument:
    def __init__(self) -> None:
        self.pages: List[List[str]] = [[]]
        self.y = 742.0
        self.col = 0
        self.in_two_col = False
        self.top_y = 742.0
        self.bottom_y = 52.0
        self.margin = 44.0
        self.page_w = 612.0
        self.col_w = 252.0
        self.col_gap = 20.0

    def _push(self, cmd: str) -> None:
        self.pages[-1].append(cmd)

    def _new_page(self) -> None:
        self.pages.append([])
        self.col = 0
        self.top_y = 730.0
        self.y = self.top_y
        # Subtle IEEE running header on pages 2+
        self._push("0.55 0.60 0.68 rg BT /F5 7.0 Tf 44 756 Td (MUET Point Bus Scheduling & Fleet Rebalancing -- IEEE Technical Report) Tj ET 0 0 0 rg")
        self._push("0.4 w 0.80 0.83 0.88 RG 44 750 m 568 750 l S 0 0 0 RG")

    def _advance_cursor(self, dy: float) -> None:
        self.y -= dy
        if self.y < self.bottom_y:
            if self.in_two_col and self.col == 0:
                self.col = 1
                self.y = self.top_y
            else:
                self._new_page()

    def _ensure_space(self, needed_h: float) -> None:
        if self.y - needed_h < self.bottom_y:
            if self.in_two_col and self.col == 0:
                self.col = 1
                self.y = self.top_y
            else:
                self._new_page()

    def _col_x(self) -> float:
        return self.margin if (not self.in_two_col or self.col == 0) else self.margin + self.col_w + self.col_gap

    def _wrap(self, text: str, max_chars: int) -> List[str]:
        words = text.split()
        lines: List[str] = []
        cur = ""
        for w in words:
            if len(w) > max_chars:
                if cur:
                    lines.append(cur)
                    cur = ""
                for i in range(0, len(w), max_chars):
                    lines.append(w[i : i + max_chars])
                continue
            cand = f"{cur} {w}".strip()
            if len(cand) <= max_chars:
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]

    def add_title_block(self, title: str, authors: str, affiliation: str) -> None:
        self.in_two_col = False
        for line in self._wrap(title, 62):
            self._push(f"0.06 0.09 0.16 rg BT /F2 14.5 Tf 44 {self.y:.1f} Td ({_esc(line)}) Tj ET")
            self.y -= 18.0
        self.y -= 3.0
        self._push(f"0.12 0.16 0.24 rg BT /F1 9.5 Tf 44 {self.y:.1f} Td ({_esc(authors)}) Tj ET")
        self.y -= 12.5
        self._push(f"0.30 0.35 0.44 rg BT /F3 8.4 Tf 44 {self.y:.1f} Td ({_esc(affiliation)}) Tj ET")
        self.y -= 9.0
        self._push(f"0.8 w 0.20 0.28 0.48 RG 44 {self.y:.1f} m 568 {self.y:.1f} l S 0 0 0 RG 0 0 0 rg")
        self.y -= 17.0
        self.in_two_col = True
        self.col = 0
        self.top_y = self.y

    def add_heading(self, title: str) -> None:
        lines = self._wrap(title, 34)
        needed = len(lines) * 11.5 + 68.0
        self._ensure_space(needed)
        self.y -= 4.0
        x = self._col_x()
        for line in lines:
            self._push(f"0.07 0.13 0.30 rg BT /F2 9.4 Tf {x:.1f} {self.y:.1f} Td ({_esc(line)}) Tj ET 0 0 0 rg")
            self._advance_cursor(11.5)
        self._push(f"0.4 w 0.78 0.82 0.90 RG {x:.1f} {self.y + 7.5:.1f} m {x + self.col_w:.1f} {self.y + 7.5:.1f} l S 0 0 0 RG")
        self._advance_cursor(4.0)

    def add_paragraph(self, text: str, bold: bool = False, italic: bool = False, font_size: float = 8.2) -> None:
        font = "/F2" if bold else ("/F3" if italic else "/F1")
        max_chars = 56 if font_size <= 8.2 else 52
        for line in self._wrap(text, max_chars):
            self._ensure_space(font_size + 4.0)
            x = self._col_x()
            self._push(f"0.10 0.13 0.18 rg BT {font} {font_size:.1f} Tf {x:.1f} {self.y:.1f} Td ({_esc(line)}) Tj ET 0 0 0 rg")
            self._advance_cursor(font_size + 2.1)
        self._advance_cursor(1.8)

    def add_code_block(self, label: str, code_lines: Sequence[str]) -> None:
        wrapped_rows: List[str] = []
        for cl in code_lines:
            wrapped_rows.extend(self._wrap(cl, 53))
        box_h = 14.0 + len(wrapped_rows) * 8.8 + 6.0
        self._ensure_space(box_h + 6.0)
        x = self._col_x()
        top_y = self.y + 6.0
        bot_y = top_y - box_h
        # Light slate background + border
        self._push(f"0.95 0.96 0.99 rg {x:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re f")
        self._push(f"0.4 w 0.78 0.83 0.92 RG {x:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re S")
        self._push(f"0.18 0.24 0.50 rg BT /F6 6.8 Tf {x + 5:.1f} {top_y - 10:.1f} Td ({_esc(label)}) Tj ET")
        cy = top_y - 20.0
        for row in wrapped_rows:
            self._push(f"0.08 0.12 0.20 rg BT /F4 6.6 Tf {x + 5:.1f} {cy:.1f} Td ({_esc(row)}) Tj ET")
            cy -= 8.8
        self._push("0 0 0 rg 0 0 0 RG")
        self.y = bot_y - 7.0

    def add_table(
        self,
        caption: str,
        headers: List[str],
        rows: List[List[str]],
        col_widths: Optional[List[float]] = None,
        highlight_row_idx: Optional[int] = None,
    ) -> None:
        ncols = max(1, len(headers))
        if col_widths is None:
            weights = [1.0 / ncols] * ncols
        else:
            s = sum(col_widths) or 1.0
            weights = [w / s for w in col_widths]
        px_widths = [w * self.col_w for w in weights]

        def wrap_row(cells: Sequence[str], char_pt: float) -> Tuple[List[List[str]], int]:
            wrapped_cells: List[List[str]] = []
            max_lines = 1
            for ci, cell in enumerate(cells):
                usable_w = max(14.0, px_widths[ci] - 5.0)
                max_c = max(4, int(usable_w / char_pt))
                lines = self._wrap(str(cell), max_c)[:2]
                wrapped_cells.append(lines)
                if len(lines) > max_lines:
                    max_lines = len(lines)
            return wrapped_cells, max_lines

        header_wrapped, h_lines = wrap_row(headers, 3.85)
        body_wrapped = [wrap_row(r, 3.65) for r in rows]
        cap_lines = self._wrap(caption, 44)

        total_h = (
            len(cap_lines) * 9.8
            + 4.0
            + h_lines * 8.8
            + 5.0
            + sum(rl * 8.4 + 3.0 for _, rl in body_wrapped)
            + 8.0
        )
        self._ensure_space(total_h)

        x0 = self._col_x()
        for cl in cap_lines:
            self._push(f"0.08 0.12 0.22 rg BT /F2 7.5 Tf {x0:.1f} {self.y:.1f} Td ({_esc(cl)}) Tj ET 0 0 0 rg")
            self._advance_cursor(9.5)

        # Header shading
        hdr_h = h_lines * 8.8 + 4.0
        hdr_bot = self.y - hdr_h + 7.5
        self._push(f"0.92 0.94 0.98 rg {x0:.1f} {hdr_bot:.1f} {self.col_w:.1f} {hdr_h:.1f} re f 0 0 0 rg")
        self._push(f"0.6 w 0.15 0.22 0.38 RG {x0:.1f} {hdr_bot + hdr_h:.1f} m {x0 + self.col_w:.1f} {hdr_bot + hdr_h:.1f} l S")

        cx = x0
        for ci, cell_lines in enumerate(header_wrapped):
            cy = self.y
            for ln in cell_lines:
                self._push(f"0.06 0.10 0.22 rg BT /F6 6.4 Tf {cx + 2.5:.1f} {cy:.1f} Td ({_esc(ln)}) Tj ET")
                cy -= 8.5
            cx += px_widths[ci]
        self._advance_cursor(h_lines * 8.8 + 2.5)
        self._push(f"0.4 w 0.35 0.42 0.56 RG {x0:.1f} {self.y + 6.5:.1f} m {x0 + self.col_w:.1f} {self.y + 6.5:.1f} l S 0 0 0 RG")

        for ri, (cell_lists, r_lines) in enumerate(body_wrapped):
            row_h = r_lines * 8.4 + 3.0
            if highlight_row_idx is not None and ri == highlight_row_idx:
                self._push(f"0.92 0.98 0.95 rg {x0:.1f} {self.y - row_h + 7.5:.1f} {self.col_w:.1f} {row_h:.1f} re f 0 0 0 rg")
            cx = x0
            for ci, cell_lines in enumerate(cell_lists):
                cy = self.y
                font_tag = "/F6" if (highlight_row_idx == ri) else ("/F5" if ci == 0 else "/F5")
                color = "0.02 0.35 0.22 rg" if (highlight_row_idx == ri) else "0.12 0.15 0.22 rg"
                for ln in cell_lines:
                    self._push(f"{color} BT {font_tag} 6.3 Tf {cx + 2.5:.1f} {cy:.1f} Td ({_esc(ln)}) Tj ET")
                    cy -= 8.2
                cx += px_widths[ci]
            self._advance_cursor(row_h)
            if ri < len(body_wrapped) - 1:
                self._push(f"0.25 w 0.88 0.90 0.94 RG {x0:.1f} {self.y + 6.8:.1f} m {x0 + self.col_w:.1f} {self.y + 6.8:.1f} l S")

        self._push(f"0.6 w 0.15 0.22 0.38 RG {x0:.1f} {self.y + 6.5:.1f} m {x0 + self.col_w:.1f} {self.y + 6.5:.1f} l S 0 0 0 RG 0 0 0 rg")
        self._advance_cursor(5.5)

    def add_state_diagram(self, caption: str) -> None:
        box_h = 104.0
        cap_lines = self._wrap(caption, 56)
        self._ensure_space(box_h + len(cap_lines) * 9.5 + 10.0)
        x0 = self._col_x()
        top_y = self.y + 6.0
        bot_y = top_y - box_h
        self._push(f"0.98 0.99 1.00 rg {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re f")
        self._push(f"0.4 w 0.80 0.84 0.90 RG {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re S")

        nodes = [
            ("IDLE", 10, 62, 54, 24, "0.91 0.96 0.93", "0.06 0.55 0.36"),
            ("BOARDING", 94, 62, 64, 24, "0.93 0.95 1.00", "0.26 0.33 0.84"),
            ("IN_TRANSIT", 186, 62, 58, 24, "0.92 0.97 0.99", "0.05 0.45 0.72"),
            ("REPOSITION", 10, 14, 68, 24, "1.00 0.97 0.90", "0.80 0.45 0.05"),
            ("DELAYED", 100, 14, 62, 24, "1.00 0.94 0.94", "0.82 0.18 0.18"),
            ("OUT_OF_SVC", 184, 14, 60, 24, "0.94 0.95 0.96", "0.35 0.40 0.48"),
        ]
        for lbl, dx, dy, w, h, fill, stroke in nodes:
            nx, ny = x0 + dx, bot_y + dy
            self._push(f"{fill} rg {nx:.1f} {ny:.1f} {w:.1f} {h:.1f} re f")
            self._push(f"0.7 w {stroke} RG {nx:.1f} {ny:.1f} {w:.1f} {h:.1f} re S")
            self._push(f"{stroke} rg BT /F6 6.2 Tf {nx + 5:.1f} {ny + 9:.1f} Td ({_esc(lbl)}) Tj ET")

        # Connectors
        self._push("0.7 w 0.30 0.36 0.46 RG")
        # IDLE -> BOARDING -> IN_TRANSIT
        self._push(f"{x0 + 64:.1f} {bot_y + 74:.1f} m {x0 + 94:.1f} {bot_y + 74:.1f} l S")
        self._push(f"{x0 + 158:.1f} {bot_y + 74:.1f} m {x0 + 186:.1f} {bot_y + 74:.1f} l S")
        # IDLE -> REPOSITION, IN_TRANSIT -> DELAYED, IN_TRANSIT -> OUT_OF_SVC
        self._push(f"{x0 + 37:.1f} {bot_y + 62:.1f} m {x0 + 37:.1f} {bot_y + 38:.1f} l S")
        self._push(f"{x0 + 198:.1f} {bot_y + 62:.1f} m {x0 + 142:.1f} {bot_y + 38:.1f} l S")
        self._push(f"{x0 + 215:.1f} {bot_y + 62:.1f} m {x0 + 215:.1f} {bot_y + 38:.1f} l S")
        self._push(f"{x0 + 78:.1f} {bot_y + 26:.1f} m {x0 + 100:.1f} {bot_y + 26:.1f} l S")
        self._push("0 0 0 rg 0 0 0 RG")

        self.y = bot_y - 10.0
        for cl in cap_lines:
            self._push(f"0.16 0.20 0.28 rg BT /F3 7.2 Tf {x0:.1f} {self.y:.1f} Td ({_esc(cl)}) Tj ET 0 0 0 rg")
            self._advance_cursor(9.2)
        self._advance_cursor(4.0)

    def add_bar_chart(
        self,
        caption: str,
        items: List[Tuple[str, float, float]],
        left_label: str = "Avg Wait (m)",
        right_label: str = "Pax Util (%)",
    ) -> None:
        """Grouped dual-metric horizontal bar chart for Wait vs Pax Util."""
        box_h = 114.0
        cap_lines = self._wrap(caption, 56)
        self._ensure_space(box_h + len(cap_lines) * 9.5 + 10.0)
        x0 = self._col_x()
        top_y = self.y + 6.0
        bot_y = top_y - box_h
        self._push(f"0.99 0.99 1.00 rg {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re f")
        self._push(f"0.4 w 0.80 0.84 0.90 RG {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re S")

        # Legend
        self._push(f"0.86 0.24 0.24 rg {x0 + 8:.1f} {top_y - 12:.1f} 8 6 re f")
        self._push(f"0.15 0.18 0.25 rg BT /F5 6.2 Tf {x0 + 19:.1f} {top_y - 11:.1f} Td ({_esc(left_label)}) Tj ET")
        self._push(f"0.06 0.58 0.42 rg {x0 + 102:.1f} {top_y - 12:.1f} 8 6 re f")
        self._push(f"0.15 0.18 0.25 rg BT /F5 6.2 Tf {x0 + 113:.1f} {top_y - 11:.1f} Td ({_esc(right_label)}) Tj ET")

        max_w = max((v1 for _, v1, _ in items), default=1.0) or 1.0
        max_u = 70.0
        bar_area_x = x0 + 62.0
        bar_max_w = 148.0
        row_step = (box_h - 24.0) / max(1, len(items))
        for idx, (lbl, wait_v, util_v) in enumerate(items):
            ry = top_y - 25.0 - idx * row_step
            self._push(f"0.12 0.16 0.24 rg BT /F6 6.2 Tf {x0 + 6:.1f} {ry - 2:.1f} Td ({_esc(lbl[:12])}) Tj ET")
            w1 = max(2.0, min(bar_max_w, (wait_v / max_w) * bar_max_w))
            w2 = max(2.0, min(bar_max_w, (util_v / max_u) * bar_max_w))
            self._push(f"0.86 0.24 0.24 rg {bar_area_x:.1f} {ry:.1f} {w1:.1f} 5.2 re f")
            self._push(f"0.22 0.26 0.34 rg BT /F5 5.8 Tf {bar_area_x + w1 + 3:.1f} {ry:.1f} Td ({wait_v:.2f}m) Tj ET")
            self._push(f"0.06 0.58 0.42 rg {bar_area_x:.1f} {ry - 6.5:.1f} {w2:.1f} 5.2 re f")
            self._push(f"0.04 0.38 0.26 rg BT /F5 5.8 Tf {bar_area_x + w2 + 3:.1f} {ry - 6.5:.1f} Td ({util_v:.1f}%) Tj ET")
        self._push("0 0 0 rg 0 0 0 RG")

        self.y = bot_y - 10.0
        for cl in cap_lines:
            self._push(f"0.16 0.20 0.28 rg BT /F3 7.2 Tf {x0:.1f} {self.y:.1f} Td ({_esc(cl)}) Tj ET 0 0 0 rg")
            self._advance_cursor(9.2)
        self._advance_cursor(4.0)

    def add_pareto_plot(self, caption: str, points: List[Dict]) -> None:
        box_h = 122.0
        cap_lines = self._wrap(caption, 56)
        self._ensure_space(box_h + len(cap_lines) * 9.5 + 10.0)
        x0 = self._col_x()
        top_y = self.y + 6.0
        bot_y = top_y - box_h
        self._push(f"0.99 0.99 1.00 rg {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re f")
        self._push(f"0.4 w 0.80 0.84 0.90 RG {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re S")

        px0, py0 = x0 + 30.0, bot_y + 22.0
        pw, ph = self.col_w - 42.0, box_h - 36.0
        # Gridlines
        for frac in (0.25, 0.5, 0.75, 1.0):
            gy = py0 + frac * ph
            gx = px0 + frac * pw
            self._push(f"0.25 w 0.90 0.92 0.95 RG {px0:.1f} {gy:.1f} m {px0 + pw:.1f} {gy:.1f} l S")
            self._push(f"0.25 w 0.90 0.92 0.95 RG {gx:.1f} {py0:.1f} m {gx:.1f} {py0 + ph:.1f} l S")
        # Axes
        self._push(f"0.6 w 0.25 0.30 0.40 RG {px0:.1f} {py0:.1f} m {px0 + pw:.1f} {py0:.1f} l S {px0:.1f} {py0:.1f} m {px0:.1f} {py0 + ph:.1f} l S")
        self._push(f"0.18 0.22 0.30 rg BT /F5 6.0 Tf {px0 + 46:.1f} {bot_y + 7:.1f} Td (Pax-Carrying Utilization (%) -> better) Tj ET")
        self._push(f"0.18 0.22 0.30 rg BT /F5 6.0 Tf {x0 + 4:.1f} {top_y - 10:.1f} Td (Wait(m)) Tj ET")

        max_w = 34.0
        min_u, max_u = 18.0, 68.0
        color_map = {
            "BASELINE_CURRENT": "0.85 0.20 0.20",
            "BASELINE_BEST_STATIC": "0.24 0.38 0.82",
            "QUEUE_AWARE": "0.85 0.52 0.08",
            "ADAPTIVE_HEADWAY": "0.52 0.28 0.78",
            "COMBINED": "0.04 0.58 0.38",
        }
        for pt in points:
            u = max(min_u, min(max_u, float(pt.get("utilization_pct", 30.0))))
            w = max(0.0, min(max_w, float(pt.get("avg_wait_min", 5.0))))
            cx = px0 + ((u - min_u) / (max_u - min_u)) * pw
            cy = py0 + (w / max_w) * ph
            col = color_map.get(pt.get("policy", ""), "0.35 0.40 0.50")
            sz = 4.6 if pt.get("policy") == "COMBINED" and pt.get("fleet_size") == 10 else 3.2
            self._push(f"{col} rg {cx - sz/2:.1f} {cy - sz/2:.1f} {sz:.1f} {sz:.1f} re f")

        # Annotate key c=10 policies with non-overlapping offsets
        for lbl, u_val, w_val, col, dx_off, dy_off in [
            ("12m (30.8m)", 23.5, 30.8, "0.85 0.20 0.20", -6.0, -11.0),
            ("BestStat (3.1m, 44%)", 44.2, 3.1, "0.24 0.38 0.82", -58.0, 12.0),
            ("Combined (2.4m, 55%)", 54.7, 2.4, "0.04 0.58 0.38", -22.0, 22.0),
        ]:
            cx = px0 + ((u_val - min_u) / (max_u - min_u)) * pw
            cy = py0 + (w_val / max_w) * ph
            tx = min(px0 + pw - 74.0, max(px0 + 4.0, cx + dx_off))
            ty = min(py0 + ph - 8.0, max(py0 + 4.0, cy + dy_off))
            self._push(f"{col} rg BT /F6 5.6 Tf {tx:.1f} {ty:.1f} Td ({_esc(lbl)}) Tj ET")

        self._push("0 0 0 rg 0 0 0 RG")
        self.y = bot_y - 10.0
        for cl in cap_lines:
            self._push(f"0.16 0.20 0.28 rg BT /F3 7.2 Tf {x0:.1f} {self.y:.1f} Td ({_esc(cl)}) Tj ET 0 0 0 rg")
            self._advance_cursor(9.2)
        self._advance_cursor(4.0)

    def add_fleet_sweep_chart(self, caption: str, fleet_sweep: List[Dict]) -> None:
        box_h = 114.0
        cap_lines = self._wrap(caption, 56)
        self._ensure_space(box_h + len(cap_lines) * 9.5 + 10.0)
        x0 = self._col_x()
        top_y = self.y + 6.0
        bot_y = top_y - box_h
        self._push(f"0.99 0.99 1.00 rg {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re f")
        self._push(f"0.4 w 0.80 0.84 0.90 RG {x0:.1f} {bot_y:.1f} {self.col_w:.1f} {box_h:.1f} re S")

        px0, py0 = x0 + 28.0, bot_y + 20.0
        pw, ph = self.col_w - 40.0, box_h - 34.0
        max_w = 24.0
        # SLA line at 5m
        sla_y = py0 + (5.0 / max_w) * ph
        self._push(f"0.6 w 0.85 0.25 0.25 RG {px0:.1f} {sla_y:.1f} m {px0 + pw:.1f} {sla_y:.1f} l S")
        self._push(f"0.75 0.15 0.15 rg BT /F6 5.8 Tf {px0 + pw - 52:.1f} {sla_y + 3:.1f} Td (SLA <= 5.0m) Tj ET")

        self._push(f"0.6 w 0.25 0.30 0.40 RG {px0:.1f} {py0:.1f} m {px0 + pw:.1f} {py0:.1f} l S {px0:.1f} {py0:.1f} m {px0:.1f} {py0 + ph:.1f} l S")
        self._push(f"0.18 0.22 0.30 rg BT /F5 5.8 Tf {px0 + 62:.1f} {bot_y + 6:.1f} Td (Fleet Size c (buses)) Tj ET")

        def plot_series(key: str, rgb: str) -> None:
            pts = []
            for row in fleet_sweep:
                c = float(row["fleetSize"])
                val = min(max_w, float(row[key]))
                cx = px0 + ((c - 4.0) / 10.0) * pw
                cy = py0 + (val / max_w) * ph
                pts.append((cx, cy))
            if len(pts) >= 2:
                self._push(f"1.1 w {rgb} RG {pts[0][0]:.1f} {pts[0][1]:.1f} m " + " ".join(f"{x:.1f} {y:.1f} l" for x, y in pts[1:]) + " S")
            for cx, cy in pts:
                self._push(f"{rgb} rg {cx - 1.6:.1f} {cy - 1.6:.1f} 3.2 3.2 re f")

        plot_series("bestStaticAvgWait", "0.24 0.38 0.82")
        plot_series("combinedAvgWait", "0.04 0.58 0.38")

        for row in fleet_sweep:
            c = int(row["fleetSize"])
            if c in (4, 6, 7, 8, 10, 12, 14):
                cx = px0 + ((c - 4.0) / 10.0) * pw
                self._push(f"0.22 0.26 0.34 rg BT /F5 5.6 Tf {cx - 3:.1f} {py0 - 8:.1f} Td ({c}) Tj ET")

        # Legend
        self._push(f"0.24 0.38 0.82 rg BT /F6 6.0 Tf {px0 + 4:.1f} {top_y - 11:.1f} Td (Blue: Best Static c>=8) Tj ET")
        self._push(f"0.04 0.58 0.38 rg BT /F6 6.0 Tf {px0 + 104:.1f} {top_y - 11:.1f} Td (Green: Combined c>=7) Tj ET")
        self._push("0 0 0 rg 0 0 0 RG")

        self.y = bot_y - 10.0
        for cl in cap_lines:
            self._push(f"0.16 0.20 0.28 rg BT /F3 7.2 Tf {x0:.1f} {self.y:.1f} Td ({_esc(cl)}) Tj ET 0 0 0 rg")
            self._advance_cursor(9.2)
        self._advance_cursor(4.0)

    def build_bytes(self) -> bytes:
        objs: List[str] = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            "2 0 obj\n<< /Type /Pages /Kids [__KIDS__] /Count __COUNT__ >>\nendobj\n",
            "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>\nendobj\n",
            "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>\nendobj\n",
            "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>\nendobj\n",
            "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n",
            "7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
            "8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n",
        ]
        page_ids: List[int] = []
        next_id = 9
        for pi, cmds in enumerate(self.pages):
            footer = (
                f"0.45 0.50 0.58 rg BT /F5 7.5 Tf 285 28 Td (Page {pi + 1} of {len(self.pages)}) Tj ET 0 0 0 rg"
            )
            stream = "\n".join(cmds + [footer])
            content_id = next_id
            page_id = next_id + 1
            next_id += 2
            page_ids.append(page_id)
            objs.append(
                f"{content_id} 0 obj\n<< /Length {len(stream.encode('latin1'))} >>\nstream\n{stream}\nendstream\nendobj\n"
            )
            objs.append(
                f"{page_id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R /F6 8 0 R >> >> "
                f"/Contents {content_id} 0 R >>\nendobj\n"
            )

        objs[1] = (
            objs[1]
            .replace("__KIDS__", " ".join(f"{pid} 0 R" for pid in page_ids))
            .replace("__COUNT__", str(len(page_ids)))
        )

        out = "%PDF-1.4\n"
        offsets = [0]
        for obj in objs:
            offsets.append(len(out.encode("latin1")))
            out += obj
        xref_pos = len(out.encode("latin1"))
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
        for off in offsets[1:]:
            out += f"{off:010d} 00000 n \n"
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
        return out.encode("latin1")
