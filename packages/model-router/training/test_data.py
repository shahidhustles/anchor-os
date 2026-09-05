import copy
import hashlib
import json
import unittest
from pathlib import Path
from common import label, validate_output, validate_request

ROOT = Path(__file__).resolve().parents[1]


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.splits = {s:[json.loads(line) for line in (ROOT/'data'/f'{s}.jsonl').read_text().splitlines()]
                      for s in ['train','validation','test']}

    def test_disjoint_subfamilies_and_requests(self):
        for left,right in [('train','validation'),('train','test'),('validation','test')]:
            self.assertFalse({r['metadata']['subfamily'] for r in self.splits[left]} &
                             {r['metadata']['subfamily'] for r in self.splits[right]})
            self.assertFalse({r['input']['user_task'] for r in self.splits[left]} &
                             {r['input']['user_task'] for r in self.splits[right]})

    def test_manifest_matches_saved_bytes(self):
        manifest = json.loads((ROOT/'data/manifest.json').read_text())
        for split,rows in self.splits.items():
            self.assertEqual(manifest['splits'][split]['count'],len(rows))
            self.assertEqual(manifest['splits'][split]['sha256'],
                hashlib.sha256((ROOT/'data'/f'{split}.jsonl').read_bytes()).hexdigest())

    def test_all_labels_and_anonymization(self):
        for rows in self.splits.values():
            self.assertGreaterEqual(sum(r['metadata']['anonymous'] for r in rows)/len(rows),.3)
            self.assertEqual(len({json.dumps(r['input'],sort_keys=True) for r in rows}),len(rows))
            for row in rows:
                validate_request(row['input'])
                self.assertEqual(validate_output(json.dumps(row['output']),row['input']),row['output'])
                self.assertEqual(label(row['input'],row['metadata']['requirements']),row['output'])

    def test_teacher_uses_profiles_not_names_or_order(self):
        for row in self.splits['test']:
            request = copy.deepcopy(row['input'])
            request['profiles'].reverse()
            request['candidate_models'].reverse()
            self.assertEqual(label(request,row['metadata']['requirements']),row['output'])
            mapping = {slug:f'unseen_{i}' for i,slug in enumerate(request['candidate_models'])}
            for p in request['profiles']:
                p['model_slug'] = mapping[p['model_slug']]
            request['candidate_models'] = [mapping[s] for s in request['candidate_models']]
            self.assertEqual(label(request,row['metadata']['requirements'])['model_slug'],mapping[row['output']['model_slug']])

    def test_reject_invalid_output(self):
        request = self.splits['test'][0]['input']
        for raw in ['{}','not json',json.dumps({'model_slug':'missing','confidence':.9}),
                    json.dumps({'model_slug':request['candidate_models'][0],'confidence':True}),
                    json.dumps({'model_slug':request['candidate_models'][0],'confidence':float('nan')})]:
            with self.assertRaises(ValueError):
                validate_output(raw,request)

    def test_hard_constraints_and_vision_pool(self):
        request = copy.deepcopy(self.splits['test'][0]['input'])
        candidate = request['profiles'][0]
        candidate['features']['multimodal'] = False
        candidate['features']['tool_calling'] = True
        request['requires_tools'] = True
        request['input_tokens'] = 1
        output = json.dumps({'model_slug':candidate['model_slug'],'confidence':.7})
        validate_output(output,request)
        candidate['features']['tool_calling'] = False
        with self.assertRaises(ValueError):
            validate_output(output,request)
        request['requires_tools'] = False
        request['input_tokens'] = candidate['runtime']['usable_context']+1
        with self.assertRaises(ValueError):
            validate_output(output,request)


if __name__ == '__main__':
    unittest.main()
