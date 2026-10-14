import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline_aot_slicer import number,pick_num,summarize

class AotSliceTests(unittest.TestCase):
    def test_num(self):
        self.assertEqual(number('0x295558'),0x295558)
        self.assertEqual(number('2708824'),2708824)
        self.assertIsNone(number('notAnAddress'))
    def test_structured_safe(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            f=p/'functions.jsonl';e=p/'call_edges.jsonl';s=p/'string_refs.jsonl'
            f.write_text(json.dumps({'pc':'0x295558','size':2164,'name':'createFinalPrompt'})+'\n'+
                         json.dumps({'pc':'0x12345','name':'secretFunction'})+'\n')
            e.write_text(json.dumps({'from_pc':'0x295560','to_pc':'0x27d25c','kind':'BL'})+'\n')
            s.write_text(json.dumps({'pc':'0x295560','string':'prompt'})+'\n'+
                         json.dumps({'pc':'0x295560','string':'MY_SECRET_CODE_XYZ'})+'\n')
            res=summarize({'functions':f,'edges':e,'strings':s},{0x295558,0x27d25c})
            self.assertEqual(res['function_found_count'],1)
            self.assertEqual(res['functions']['0x295558']['size'],2164)
            self.assertEqual(len(res['relevant_edges']),1)
            self.assertEqual(len(res['safe_string_refs']),1)
            self.assertNotIn('MY_SECRET_CODE_XYZ',json.dumps(res))
            self.assertEqual(res['input_sha256']['functions'],hashlib.sha256(f.read_bytes()).hexdigest())
    def test_kind_is_whitelisted(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            f=p/'functions.jsonl';e=p/'edges.jsonl'
            f.write_text(json.dumps({'pc':'0x295558','size':100,'name':'createFinalPrompt'})+'\n')
            e.write_text(json.dumps({'from_pc':'0x29555a','to_pc':'0x27d25c','kind':'UNSAFE_PRIVATE_ID'})+'\n')
            res=summarize({'functions':f,'edges':e},{0x295558,0x27d25c})
            self.assertEqual(res['relevant_edges'][0]['kind'],'UNVERIFIED_KIND')
            self.assertNotIn('UNSAFE_PRIVATE_ID',json.dumps(res))

    def test_all_matching_edges_and_input_identity_survive_edge_kind(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            f=p/'functions.jsonl';e=p/'call_edges.jsonl'
            f.write_text(json.dumps({'pc':'0x295558','size':100,'name':'createFinalPrompt'})+'\n')
            e.write_text('\n'.join(json.dumps(row) for row in [
                {'site_pc':'0x295560','target_pc':'0x27d25c','kind':'BL'},
                {'site_pc':'0x10000','target_pc':'0x20000','kind':'BL'},
                {'site_pc':'0x295570','target_pc':'0x27d25c','kind':'BL'},
            ])+'\n')
            res=summarize({'functions':f,'edges':e},{0x295558,0x27d25c})
            self.assertEqual([r['from_pc'] for r in res['relevant_edges']],
                             ['0x295560','0x295570'])
            self.assertEqual(res['input_sha256']['edges'],hashlib.sha256(e.read_bytes()).hexdigest())
            self.assertEqual(res['input_example_keys']['edges'],['kind','site_pc','target_pc'])
            self.assertNotIn('BL',res['input_sha256'])

    def test_unknown_schema_reports_fields_not_guesses(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'f.jsonl';f.write_text('{"strange_key":99}\n')
            res=summarize({'functions':f},{0x295558})
            self.assertEqual(res['function_found_count'],0)
            self.assertEqual(res['input_example_keys']['functions'],['strange_key'])

if __name__=='__main__':unittest.main()
