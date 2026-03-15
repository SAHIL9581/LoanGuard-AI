#!/usr/bin/env python
"""Test vision extraction with various PDFs."""
from app.services.vision_extractor import extract_financial_data
import json

files_to_test = [
    ("sridatta_statement.pdf", "Bank Statement"),
    ("sarvan_phonepe.pdf", "Bank Statement"),
    ("sarvan_flipkart.pdf", "Flipkart Orders"),
]

for filename, doc_type in files_to_test:
    print(f"\n{'='*60}")
    print(f"Testing: {filename} ({doc_type})")
    print('='*60)
    try:
        result = extract_financial_data(filename, doc_type)
        records = result.get("extracted_records", [])
        print(f"✅ Success! Records: {len(records)}")
        if records:
            total_txns = sum(len(r.get("transactions", [])) for r in records)
            print(f"   Total transactions: {total_txns}")
            if records[0].get("transactions"):
                print(f"   First transaction: {records[0]['transactions'][0]}")
    except Exception as e:
        print(f"❌ Error: {str(e)[:300]}")
