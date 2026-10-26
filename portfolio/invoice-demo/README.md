PDF invoices to Excel: original demonstration by Marco Bellocchio.
All names, dates, invoice numbers and transactions are fictional.
These are not previous customer projects or tax documents.

Run invoice_demo.py, then python -m unittest -v.
Requires Python, reportlab, pdfplumber and openpyxl. No external requests.
The script reproduces two synthetic text-based PDFs and an Excel workbook.
It supports exactly these two one-page layouts, not arbitrary invoices.

Inspect example-en.pdf: invoice 0007, two items, printed total EUR42.00.
Inspect example-it.pdf: invoice 0008, printed total EUR43,00.
The second invoice deliberately disagrees with its line sum EUR42.70.
The source value is retained; the discrepancy is highlighted, never corrected
by guessing. The Review sheet includes source filenames, pages and hashes.
Text identifiers and source numeric representations remain literal strings.
This is for traceable transcription; it is not a numeric accounting model.

XLSX structure and contents are reopened and checked with openpyxl.
Desktop Microsoft Excel has not been run here; compatibility with a buyer's
specific application/version must be checked during acceptance. No OCR,
tax interpretation, confidential data, accounting integration or universal
layout-recognition claims are included.

Proposed service: EUR79 for up to 20 text-selectable PDF pages, at most two
agreed layouts; header/item extraction, references, exception list, a script
for those layouts and one in-scope revision. A representative redacted sample,
acceptance criteria, delivery date, final price and payment/invoicing terms
must be agreed before an order. No deadline or purchase is implied by this demo.
