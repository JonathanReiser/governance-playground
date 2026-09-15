#!/usr/bin/env python3
"""Render the synthetic demo's generated results into a one-page review handout.
Requires reportlab. This is presentation of demo results, not a separate verifier.
"""
import argparse
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle


def render(root, output):
    cases = ['original', 'changed-support', 'changed-but-balanced']
    results = [json.loads((root / 'check-results' / (name + '.json')).read_text()) for name in cases]
    assert [r['report']['status'] for r in results] == ['PASS', 'FAIL', 'FAIL']
    assert [r['calculation']['differenceCents'] for r in results] == [0, 50000, 0]
    packages = root / 'operator-packages'
    inputs = [{f: json.loads((packages / name / (f + '.json')).read_text())
               for f in ['statement', 'ledger', 'reconciling-items']} for name in cases]
    money = lambda value: '${:,.2f}'.format(value / 100)
    ink, muted, teal, amber = map(HexColor, ['#18323B', '#53666C', '#236C62', '#825A21'])
    pale, line = HexColor('#EFF5F3'), HexColor('#D9E2E3')
    pdf = canvas.Canvas(str(output), pagesize=(612, 792))
    pdf.setTitle('What changed after review? - Synthetic reconciliation example')
    pdf.setAuthor('Jonathan Reiser')
    pdf.setSubject('Made-up quarterly-close package with simulated approval and later changes')
    left, width = 40, 532
    styles = {
        'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10.5, leading=15, textColor=ink),
        'small': ParagraphStyle('small', fontName='Helvetica', fontSize=9, leading=12.5, textColor=muted),
        'head': ParagraphStyle('head', fontName='Helvetica-Bold', fontSize=13, leading=17, textColor=ink),
    }
    def para(text, x, top, w=width, style='body'):
        p = Paragraph(text, styles[style]); _, h = p.wrap(w, 1000); p.drawOn(pdf, x, top-h); return top-h
    def rule(y):
        pdf.setStrokeColor(line); pdf.setLineWidth(.6); pdf.line(left, y, left+width, y)
    pdf.setFillColor(teal); pdf.rect(0, 776, 612, 16, stroke=0, fill=1)
    pdf.setFont('Helvetica-Bold', 9); pdf.setFillColor(teal)
    pdf.drawString(left, 746, 'QUARTERLY CLOSE  /  SYNTHETIC EXAMPLE')
    pdf.setFont('Helvetica-Bold', 25); pdf.setFillColor(ink)
    pdf.drawString(left, 709, 'What changed after review?')
    para('Keep the calculation, supporting files and review reference together. '
         'Then compare later files with the exact package retained for review.', left, 692)
    rule(644)
    para('1. Assemble one review package', left, 627, style='head')
    para('Statement summary + ledger summary + reconciling items + assumptions + '
         'review notes + calculation + <b>simulated approval</b>.', left, 602)
    para('In this example, a fictional finance reviewer is associated with the original '
         'package. The approval record refers to those exact file versions.', left, 563, style='small')
    para('2. Compare later versions', left, 522, style='head')
    rows = [['USD - period ended 30 Jun 2026', 'Original', 'Revision A', 'Revision B'],
            ['Statement balance'] + [money(v['statement']['endingBalanceCents']) for v in inputs],
            ['Add: deposits in transit'] + [money(v['reconciling-items']['depositsInTransitCents']) for v in inputs],
            ['Less: outstanding payments'] + [money(v['reconciling-items']['outstandingPaymentsCents']) for v in inputs],
            ['Adjusted statement balance'] + [money(r['calculation']['adjustedStatementCents']) for r in results],
            ['Ledger balance'] + [money(r['calculation']['ledgerCents']) for r in results],
            ['Unexplained difference'] + [money(r['calculation']['differenceCents']) for r in results]]
    table = Table(rows, colWidths=[211, 107, 107, 107], rowHeights=[31, 27, 27, 27, 29, 27, 30])
    table.setStyle(TableStyle([
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'), ('FONTSIZE',(0,0),(-1,-1),9),
        ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'), ('TEXTCOLOR',(0,0),(-1,-1),ink),
        ('BACKGROUND',(0,0),(-1,0),pale), ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('ALIGN',(1,0),(-1,-1),'RIGHT'), ('LEFTPADDING',(0,0),(-1,-1),8), ('RIGHTPADDING',(0,0),(-1,-1),8),
        ('LINEBELOW',(0,0),(-1,0),.5,line), ('LINEABOVE',(0,4),(-1,4),.5,line),
        ('FONTNAME',(0,6),(-1,6),'Helvetica-Bold'), ('BACKGROUND',(0,6),(-1,6),pale),
        ('TEXTCOLOR',(2,3),(3,3),amber), ('TEXTCOLOR',(3,2),(3,2),amber), ('TEXTCOLOR',(2,6),(2,6),amber),
    ]))
    _, h = table.wrap(width, 1000); table.drawOn(pdf, left, 493-h)
    y = 280
    for x, title, text, color in [
        (left, 'MATCHES PACKAGE', 'Original files match the retained package. Difference: $0.', teal),
        (left+183, 'CHANGE FLAGGED', 'Payments changed by $500. The calculation now differs by $500.', amber),
        (left+366, 'CHANGE FLAGGED', 'Two supporting amounts changed. It still balances, but the package is different.', amber),
    ]:
        pdf.setFillColor(color); pdf.setFont('Helvetica-Bold', 9); pdf.drawString(x, y, title)
        para(text, x, y-10, 164, 'small')
    para('<b>A reconciliation can still balance even though its supporting files have changed.</b>', left, 209)
    para('In both revisions, the original simulated approval no longer matches the current '
         'package. The changes can be surfaced for review instead of silently treating the '
         'revised files as the earlier reviewed version.', left, 168)
    rule(111)
    para('<b>What this example establishes:</b> whether presented files match a retained package. '
         'All amounts, notes and approvals are made up. It does not authenticate a real approval, '
         'prove a review occurred, or establish trusted approval time. Real use would require '
         'connections to the source systems and an actual approval process.', left, 98, style='small')
    pdf.setFillColor(muted); pdf.setFont('Helvetica',8); pdf.drawString(left,28,'Discussion example | No real financial institution or confidential data')
    pdf.drawRightString(572,28,'1 / 1')
    pdf.showPage(); pdf.save()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--demo', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    render(args.demo, args.output)
