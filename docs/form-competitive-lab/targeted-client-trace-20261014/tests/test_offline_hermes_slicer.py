import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline_hermes_slicer import HEAD, clean_instruction, load_labels, scan

SAMPLE = '''=> [Function #20352 "gen" of 328 bytes]: 4 params, frame size=6, strict=True, exc handler=False, debug info=False  @ offset 0x00099123

Bytecode listing:

==> 000000 GetById r0, r1, "itemIds"
==> 000005 LoadConstString r1, "https://secret.example/internal/key"
==> 000015 PutById r2, r3, "collection"
==> 000020 LoadConstString r4, "Japanese"
==> 000030 CallDirect r1, r2, 20355
===============
=> [Generator function #20355 "another" of 111 bytes]: 1 params, frame size=4, strict=True, exc handler=False, debug info=False  @ offset 0x000aa101
Bytecode listing:
==> 000001 GetById r1, r0, "outputs"
==> 000002 GetById r1, r0, "credit"
==> 000003 GetById r1, r0, "unknown_secret_property"
===============
=> [Function #9782 "wrapr" of 777 bytes]: 5 params, frame size=4, strict=True, exc handler=False, debug info=False  @ offset 0x001b98a3
Bytecode listing:
==> 000001 PutById r0, r1, "modificationType"
==> 000002 PutById r1, r0, "parameters"
==> 000003 LoadConstString r2, "MY_HIDDEN_SECRET"
===============
'''

class HermessliceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'sample.hasm'
        self.path.write_text(SAMPLE, encoding='utf-8')
        self.labels_csv=Path(self.tmp.name)/'labels.csv'
        self.labels_csv.write_text('observed_label\nJapanese\nFuturistic\n', encoding='utf-8')
    def tearDown(self): self.tmp.cleanup()
    def test_header(self):
        self.assertEqual(HEAD.match(SAMPLE.splitlines()[0]).group('id'), '20352')
        self.assertEqual(HEAD.match([x for x in SAMPLE.splitlines() if 'Generator function' in x][0]).group('id'), '20355')
    def test_redaction(self):
        a=clean_instruction('000001 LoadConstString r1, "https://private.example/x?a=b"')
        self.assertNotIn('private.example',a)
        self.assertNotIn('x?a=b',a)
        self.assertIn('<redacted-literal>',a)
        b=clean_instruction('GetById r0, r1, "itemIds"')
        self.assertIn('"itemIds"',b)
        c=clean_instruction('LoadConstString r3, "MY_HIDDEN_SECRET"')
        self.assertNotIn('MY_HIDDEN_SECRET',c)
    def test_targeting_and_labels(self):
        r=scan(self.path,'modyfy',load_labels(self.labels_csv),{20352,20355})
        self.assertEqual(r['function_headers_seen'],3)
        self.assertEqual(r['target_found_count'],2)
        self.assertEqual(r['catalog_labels_found_count'],1)
        self.assertEqual(r['catalog_string_matches']['Japanese']['function_ids'],[20352])
        self.assertEqual(r['catalog_string_matches']['Futuristic']['occurrences'],0)
        self.assertEqual(r['selected_functions']['20352']['safe_property_refs']['itemIds']['count'],1)
        self.assertIn(20355,r['selected_functions']['20352']['candidate_closure_refs'])
        self.assertNotIn('private.example',json.dumps(r))
        self.assertNotIn('MY_HIDDEN_SECRET',json.dumps(r))
    def test_wrapr(self):
        r=scan(self.path,'wrapr',[],{9782})
        self.assertEqual(r['selected_functions']['9782']['offset'],'0x001b98a3')
        self.assertEqual(set(r['selected_functions']['9782']['safe_property_refs']),{'modificationType','parameters'})
    def test_no_false_negative_claim(self):
        r=scan(self.path,'modyfy',[],{99999})
        self.assertEqual(r['target_found_count'],0)
        self.assertIn('not proof', ' '.join(r['warnings']))
    def test_hard_limit(self):
        r=scan(self.path,'modyfy',[],{20352},max_per_function=2)
        self.assertEqual(len(r['selected_functions']['20352']['sample_instructions']),2)

if __name__=='__main__': unittest.main()
