#!/usr/bin/env python3
"""A focused, private, read-only summary of existing unflutter-iOS JSONL outputs.
No disassembly, no network, no execution of competitor binaries, and no raw private literals.
Handles common field spellings conservatively; unknown schemas get key reports rather than guesses.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

TARGETS = (0x295558,0x354c44,0x27d25c,0x280cd0,0x283f0c,0x2f4510,
           0x2f57c4,0x2f631c,0x2f80e0,0x2f9f68,0x28dd68)
SAFE_WORDS = {'generatePrompts','type','prompt','yourColor','imageUrl',
              'aspectRatio','workFlowId','imageUrls','imageSize','predictionID'}
ALLOWED_NAMES = {'createFinalPrompt','getGeneratePrompts','generateAdvancedStyleApiCall',
                 'imageToUrlProcessImageInput','compressAndGetFile','getMultiSectionPrompt',
                 'toolImageEditWithFlux','toolImageEditWithPImage','toolImageEditWithWorkflow',
                 'toolImageEditWithTopaz'}
F_START = ('pc','start_pc','start','address','addr','function_pc')
F_SIZE = ('size','byte_size','size_bytes','length')
E_SOURCE = ('source_pc','src_pc','from_pc','caller_pc','site_pc','pc','source','from')
E_TARGET = ('target_pc','dst_pc','to_pc','callee_pc','target','destination','to')
S_LOCATION = ('pc','source_pc','location_pc','insn_pc','ref_pc','address')
S_VALUE = ('string','value','text','literal')


def number(v):
    if isinstance(v,int): return v
    if isinstance(v,str):
        s=v.strip()
        try: return int(s, 0) if s.startswith(('0x','0X')) else int(s)
        except ValueError: return None
    return None

def pick_num(row,keys):
    for key in keys:
        if key in row:
            z=number(row[key])
            if z is not None: return z
    return None

def rows(path,sha):
    with path.open('rb') as f:
        for b in f:
            sha.update(b)
            try:
                d=json.loads(b)
                if isinstance(d,dict): yield d
            except (UnicodeDecodeError, ValueError): pass

def summarize(files,targets):
    out={'schema':'FORM_AOT_STATIC_SLICE_V1','targets':[hex(a) for a in sorted(targets)],
         'input_sha256':{},'input_basename':{},'input_example_keys':{},
         'functions':{},'relevant_edges':[],'safe_string_refs':[],
         'warnings':['STATIC-ONLY. Tool parser schema may vary; missing fields and zero matches are not proof of absent business logic.',
          'Call-site range matches are index candidates only; indirect dispatch or inlining may omit edges.',
          'No full prompts, sensitive strings, internal hosts or original binary bytes exported.',
          'Output remains PRIVATE and needs human redaction review before any public upload.']}
    funs={}
    symbol_pcs={}
    for kind,path in files.items():
        if path is None: continue
        if not path.is_file(): raise FileNotFoundError(path)
        h=hashlib.sha256()
        out['input_basename'][kind]=path.name
        known=0; first_keys=set()
        for row in rows(path,h):
            if known<2:
                first_keys.update(row.keys());known+=1
            if kind=='functions':
                start=pick_num(row,F_START)
                name=row.get('name') or row.get('function_name') or ''
                if not isinstance(name,str): name=''
                if start is not None and name:
                    symbol_pcs.setdefault(name,set()).add(start)
                if start in targets:
                    size=pick_num(row,F_SIZE) or 0
                    name=name if any(a in name for a in ALLOWED_NAMES) else '<unverified-name>'
                    funs[start]={'pc':hex(start),'size':size,'name_safe':name}
            elif kind=='edges':
                source=pick_num(row,E_SOURCE);target=pick_num(row,E_TARGET)
                if target is None:
                    for key in E_TARGET:
                        symbol=row.get(key)
                        matches=symbol_pcs.get(symbol,set()) if isinstance(symbol,str) else set()
                        if len(matches)==1:
                            target=next(iter(matches));break
                if source is None or target is None:continue
                source_in = any(t==source or t <= source < t+max(1,funs.get(t,{}).get('size',0)) for t in targets)
                target_in = target in targets
                if (source_in or target_in) and len(out['relevant_edges'])<300:
                    edge_kind=str(row.get('kind','unknown')).upper()
                    edge_kind=edge_kind if edge_kind in {'BL','BLR','CALL','DIRECT','UNKNOWN'} else 'UNVERIFIED_KIND'
                    out['relevant_edges'].append({'from_pc':hex(source),'to_pc':hex(target),'kind':edge_kind})
            elif kind=='strings':
                pc=pick_num(row,S_LOCATION)
                val=next((row[x] for x in S_VALUE if isinstance(row.get(x),str)),None)
                in_target = (pc is not None and any(t<=pc<t+max(1,funs.get(t,{}).get('size',0)) for t in targets))
                if in_target and val in SAFE_WORDS and len(out['safe_string_refs'])<200:
                    out['safe_string_refs'].append({'at_pc':hex(pc),'field':val})
        out['input_sha256'][kind]=h.hexdigest()
        out['input_example_keys'][kind]=sorted(first_keys)
    out['functions']={hex(k):v for k,v in sorted(funs.items())}
    out['function_found_count']=len(funs)
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--functions',required=True,type=Path)
    p.add_argument('--edges',type=Path)
    p.add_argument('--strings',type=Path)
    p.add_argument('--targets',default=','.join(hex(t) for t in TARGETS))
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    targets={number(x.strip()) for x in a.targets.split(',')}
    if None in targets:p.error('invalid --targets')
    report=summarize({'functions':a.functions,'edges':a.edges,'strings':a.strings},targets)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'function_found_count':report['function_found_count'],
                      'relevant_edges':len(report['relevant_edges']),
                      'safe_refs':len(report['safe_string_refs']),
                      'report_filename':a.output.name}))

if __name__=='__main__':main()
