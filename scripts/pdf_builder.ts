import fs from 'node:fs';

/**
 * Pure TypeScript PDF 1.4 Writer producing a valid multi-page IEEE two-column
 * academic paper with standard Helvetica / Times-Roman fonts and embedded vector graphics.
 */
export class PdfDocument {
  private pages: string[][] = [[]];
  private currentPageIdx = 0;

  // US Letter: 612 x 792 pt
  readonly pageW = 612;
  readonly pageH = 792;

  private escapeText(s: string): string {
    return s
      .replace(/[^\x20-\x7E]/g, (ch) => {
        const map: Record<string, string> = {
          '—': '-',
          '–': '-',
          '−': '-',
          '×': 'x',
          '≤': '<=',
          '≥': '>=',
          '≈': '~',
          'λ': 'lambda',
          'π': 'pi',
          'μ': 'mu',
          'ρ': 'rho',
          'δ': 'delta',
          'α': 'alpha',
          'β': 'beta',
          'γ': 'gamma',
          'η': 'eta',
          '±': '+/-',
          '→': '->',
          '∈': 'in',
          '•': '*',
          '“': '"',
          '”': '"',
          '’': "'",
          '‘': "'",
        };
        return map[ch] ?? ' ';
      })
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private pushOp(op: string) {
    this.pages[this.currentPageIdx].push(op);
  }

  newPage() {
    this.pages.push([]);
    this.currentPageIdx = this.pages.length - 1;
  }

  get pageCount() {
    return this.pages.length;
  }

  setPage(idx: number) {
    this.currentPageIdx = idx;
  }

  text(
    x: number,
    yFromTop: number,
    str: string,
    opts: { font?: 'F1' | 'F2' | 'F3' | 'F4'; size?: number; color?: [number, number, number] } = {}
  ) {
    const font = opts.font ?? 'F1'; // F1=Times, F2=Times-Bold, F3=Helvetica-Bold, F4=Courier
    const size = opts.size ?? 9;
    const [r, g, b] = opts.color ?? [0.08, 0.1, 0.14];
    const y = this.pageH - yFromTop;
    this.pushOp(
      `BT /${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x.toFixed(
        2
      )} ${y.toFixed(2)} Tm (${this.escapeText(str)}) Tj ET`
    );
  }

  line(
    x1: number,
    y1FromTop: number,
    x2: number,
    y2FromTop: number,
    width = 0.6,
    color: [number, number, number] = [0.2, 0.25, 0.35]
  ) {
    const y1 = this.pageH - y1FromTop;
    const y2 = this.pageH - y2FromTop;
    this.pushOp(
      `q ${width} w ${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(
        3
      )} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`
    );
  }

  rect(
    x: number,
    yFromTop: number,
    w: number,
    h: number,
    opts: { fill?: [number, number, number]; stroke?: [number, number, number]; lineWidth?: number } = {}
  ) {
    const yBottom = this.pageH - (yFromTop + h);
    const cmds: string[] = ['q'];
    if (opts.lineWidth) cmds.push(`${opts.lineWidth} w`);
    if (opts.fill) cmds.push(`${opts.fill[0].toFixed(3)} ${opts.fill[1].toFixed(3)} ${opts.fill[2].toFixed(3)} rg`);
    if (opts.stroke) cmds.push(`${opts.stroke[0].toFixed(3)} ${opts.stroke[1].toFixed(3)} ${opts.stroke[2].toFixed(3)} RG`);
    cmds.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (opts.fill && opts.stroke) cmds.push('B');
    else if (opts.fill) cmds.push('f');
    else cmds.push('S');
    cmds.push('Q');
    this.pushOp(cmds.join(' '));
  }

  polyline(
    pts: Array<[number, number]>,
    width = 1.4,
    color: [number, number, number] = [0.2, 0.35, 0.85]
  ) {
    if (pts.length < 2) return;
    const cmds: string[] = [
      'q',
      `${width} w`,
      `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG`,
      `${pts[0][0].toFixed(2)} ${(this.pageH - pts[0][1]).toFixed(2)} m`,
    ];
    for (let i = 1; i < pts.length; i++) {
      cmds.push(`${pts[i][0].toFixed(2)} ${(this.pageH - pts[i][1]).toFixed(2)} l`);
    }
    cmds.push('S Q');
    this.pushOp(cmds.join(' '));
  }

  wrapLines(text: string, maxWidthPt: number, fontSize: number): string[] {
    // Conservative average glyph width for Times-Roman (~0.47 * fontSize)
    const maxChars = Math.max(20, Math.floor(maxWidthPt / (fontSize * 0.47)));
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      if (!current) {
        current = w;
      } else if (current.length + 1 + w.length <= maxChars) {
        current += ' ' + w;
      } else {
        lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  save(filePath: string) {
    const objects: string[] = [];
    const addObj = (body: string) => {
      objects.push(body);
      return objects.length;
    };

    // 1: Catalog, 2: Pages placeholder
    const catalogId = addObj('');
    const pagesId = addObj('');

    // Fonts: F1 Times-Roman, F2 Times-Bold, F3 Helvetica-Bold, F4 Courier
    const f1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
    const f2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>');
    const f3Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const f4Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = addObj(
        `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`
      );
      const pageId = addObj(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageW} ${this.pageH}] /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R /F3 ${f3Id} 0 R /F4 ${f4Id} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      pageIds.push(pageId);
    }

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    fs.writeFileSync(filePath, pdf, 'utf8');
  }
}
