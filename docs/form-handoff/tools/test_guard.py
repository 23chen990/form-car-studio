import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from guard import GuardError,validate_config,check_paths,safe_relative,begin,check,verify_manifest
from check_release import verify,KINDS

def task():return {'id':'F00','depends':[],'allow':['src/safe.ts'],'maxFiles':3,'maxLines':30,'allowDelete':False,'acceptance':['a','b','c','d']}
def config():return {'specVersion':'2.2','tasks':[task()]}
class PureChecks(unittest.TestCase):
 def test_graph_ok(self):validate_config(config())
 def test_duplicate(self):
  c=config();c['tasks']*=2
  with self.assertRaises(GuardError):validate_config(c)
 def test_missing_dependency(self):
  c=config();c['tasks'][0]['depends']=['F01']
  with self.assertRaises(GuardError):validate_config(c)
 def test_cycle(self):
  a=task();b=task();a['depends']=['F01'];b.update(id='F01',depends=['F00'])
  with self.assertRaises(GuardError):validate_config({'specVersion':'2.2','tasks':[a,b]})
 def test_path_scope(self):check_paths(task(),['src/safe.ts'],10)
 def test_report_path(self):check_paths(task(),['docs/form-v2/progress/F00.json'],10)
 def test_wrong_report(self):
  with self.assertRaises(GuardError):check_paths(task(),['docs/form-v2/progress/F01.json'],10)
 def test_path_traversal(self):
  for p in ['../x','/abs','a/../../x','a\\x','-x','a\nx']:
   self.assertFalse(safe_relative(p))
 def test_out_of_scope(self):
  with self.assertRaises(GuardError):check_paths(task(),['server/provider.ts'],1)
 def test_secret_path_even_allowlisted(self):
  t=task();t['allow']=['*']
  for path in ['.env','private/key.p8','data/x.json','data-live/form.sqlite']:
   with self.assertRaises(GuardError):check_paths(t,[path],1)
 def test_workflow_restricted(self):
  t=task();t['allow']=['*']
  with self.assertRaises(GuardError):check_paths(t,['.github/workflows/x.yml'],1)
 def test_example_env_allowed_only_budget_task(self):
  t=task();t.update(id='F27',allow=['.env.example']);check_paths(t,['.env.example'],1)
 def test_example_env_disallowed_other_task(self):
  t=task();t['allow']=['*']
  with self.assertRaises(GuardError):check_paths(t,['.env.example'],1)
 def test_diff_limits(self):
  with self.assertRaises(GuardError):check_paths(task(),['src/safe.ts'],31)
 def test_delete_forbidden(self):
  with self.assertRaises(GuardError):check_paths(task(),['src/safe.ts'],1,['src/safe.ts'])
 def test_no_acceptance(self):
  c=config();c['tasks'][0]['acceptance']=[]
  with self.assertRaises(GuardError):validate_config(c)

class GitChecks(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name);self.repo=self.base/'repo';self.repo.mkdir()
  self.run_git('init','-b','codex/form-test');self.run_git('config','user.name','Synthetic Test');self.run_git('config','user.email','test@example.invalid');self.run_git('remote','add','origin','https://github.com/23chen990/form-car-studio.git')
  (self.repo/'src').mkdir();(self.repo/'src/safe.ts').write_text('export const x=1;\n');self.run_git('add','src/safe.ts');self.run_git('commit','-m','synthetic baseline')
  self.cfg=self.base/'tasks.json';self.cfg.write_text(json.dumps(config()));self.cp=self.base/'checkpoint.json'
 def run_git(self,*args):return subprocess.run(['git','-C',str(self.repo),*args],check=True,capture_output=True).stdout
 def test_begin_check_changed(self):
  begin(self.repo,task(),self.cp,self.cfg);(self.repo/'src/safe.ts').write_text('export const x=2;\n');r=check(self.repo,task(),self.cp,self.cfg);self.assertEqual(r['changedLines'],2)
 def test_checkpoint_no_overwrite(self):
  begin(self.repo,task(),self.cp,self.cfg)
  with self.assertRaises(GuardError):begin(self.repo,task(),self.cp,self.cfg)
 def test_forbidden_branch(self):
  self.run_git('branch','-m','main')
  with self.assertRaises(GuardError):begin(self.repo,task(),self.cp,self.cfg)
 def test_wrong_origin(self):
  self.run_git('remote','set-url','origin','https://github.com/other/repo.git')
  with self.assertRaises(GuardError):begin(self.repo,task(),self.cp,self.cfg)
 def test_dirty_begin(self):
  (self.repo/'oops').write_text('x')
  with self.assertRaises(GuardError):begin(self.repo,task(),self.cp,self.cfg)
 def test_untracked_scope(self):
  begin(self.repo,task(),self.cp,self.cfg);(self.repo/'oops').write_text('x')
  with self.assertRaises(GuardError):check(self.repo,task(),self.cp,self.cfg)
 def test_changed_frozen_spec(self):
  begin(self.repo,task(),self.cp,self.cfg);self.cfg.write_text('{}')
  with self.assertRaises(GuardError):check(self.repo,task(),self.cp,self.cfg)
 def test_detect_committed_scope(self):
  begin(self.repo,task(),self.cp,self.cfg);(self.repo/'oops').write_text('x');self.run_git('add','oops');self.run_git('commit','-m','unexpected')
  with self.assertRaises(GuardError):check(self.repo,task(),self.cp,self.cfg)
 def test_checkpoint_outside_repo(self):
  with self.assertRaises(GuardError):begin(self.repo,task(),self.repo/'cp.json',self.cfg)
 def test_symlink_rejected(self):
  begin(self.repo,task(),self.cp,self.cfg);(self.repo/'src/safe.ts').unlink();(self.repo/'src/safe.ts').symlink_to(self.cfg)
  with self.assertRaises(GuardError):check(self.repo,task(),self.cp,self.cfg)
 def test_no_mutation_from_check(self):
  begin(self.repo,task(),self.cp,self.cfg);before=self.run_git('rev-parse','HEAD');check(self.repo,task(),self.cp,self.cfg);self.assertEqual(self.run_git('rev-parse','HEAD'),before)

class BinaryChecks(unittest.TestCase):
 setUp = GitChecks.setUp
 run_git = GitChecks.run_git
 def asset_task(self):
  t=task();t.update(id='F31',allow=['public/form-v2/*.png'],binaryAllow=['public/form-v2/*.png'],maxBinaryBytes=32)
  return t
 def test_permitted_asset_scope(self):
  t=self.asset_task();begin(self.repo,t,self.cp,self.cfg);p=self.repo/'public/form-v2/x.png';p.parent.mkdir(parents=True);p.write_bytes(b'\x89PNG\x00abc');self.assertEqual(check(self.repo,t,self.cp,self.cfg)['binaryBytes'],8)
 def test_binary_oversize(self):
  t=self.asset_task();begin(self.repo,t,self.cp,self.cfg);p=self.repo/'public/form-v2/x.png';p.parent.mkdir(parents=True);p.write_bytes(b'\x00'*40)
  with self.assertRaises(GuardError):check(self.repo,t,self.cp,self.cfg)
 def test_binary_not_allowed_in_regular_task(self):
  begin(self.repo,task(),self.cp,self.cfg);(self.repo/'src/safe.ts').write_bytes(b'\x00x')
  with self.assertRaises(GuardError):check(self.repo,task(),self.cp,self.cfg)
 def test_binary_task_config_restricted(self):
  t=self.asset_task();t['id']='F00'
  with self.assertRaises(GuardError):validate_config({'specVersion':'2.2','tasks':[t]})

class EvidenceChecks(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);(self.root/'synthetic.md').write_text('SYNTHETIC TEST ONLY, not a release approval.');self.digest=hashlib.sha256((self.root/'synthetic.md').read_bytes()).hexdigest()
  self.data={'specVersion':'2.2','candidateCodeCommit':'a'*40,'independentReview':True,'gates':[{'id':gid,'kind':kind,'status':'VERIFIED','codeCommit':'a'*40,'reviewer':'synthetic-reviewer','evidencePath':'synthetic.md','sha256':self.digest} for gid,kind in KINDS.items()]}
 def test_complete_is_not_authorization(self):self.assertFalse(verify(self.data,self.root)['releaseAuthorizedByThisTool'])
 def test_missing_gate(self):
  self.data['gates'].pop()
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_duplicate_gate(self):
  self.data['gates'][-1]=copy.deepcopy(self.data['gates'][0])
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_not_run(self):
  self.data['gates'][0]['status']='NOT_RUN'
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_wrong_hash(self):
  self.data['gates'][0]['sha256']='b'*64
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_wrong_build(self):
  self.data['gates'][0]['codeCommit']='b'*40
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_wrong_kind(self):
  self.data['gates'][6]['kind']='unit'
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_no_independent(self):
  self.data['independentReview']=False
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_traversal(self):
  self.data['gates'][0]['evidencePath']='../secret'
  with self.assertRaises(GuardError):verify(self.data,self.root)
 def test_manifest_ok(self):
  p=self.root/'manifest.json';p.write_text(json.dumps({'files':{'synthetic.md':self.digest}}));self.assertEqual(verify_manifest(self.root,p)['files'],1)
 def test_manifest_tamper(self):
  p=self.root/'manifest.json';p.write_text(json.dumps({'files':{'synthetic.md':'b'*64}}))
  with self.assertRaises(GuardError):verify_manifest(self.root,p)
if __name__=='__main__':unittest.main()
