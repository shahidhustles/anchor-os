"""Held-out generation metrics, including raw failures before wrapper validation."""
import argparse
import copy
import json
import statistics
import time
from pathlib import Path
from common import eligible, label, validate_output
from infer import Router

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--split', choices=['validation','test'], default='test')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    router = Router(args.model)
    rows = [json.loads(s) for s in (ROOT/'data'/f'{args.split}.jsonl').read_text().splitlines()][:args.limit or None]
    outcomes = []
    for index, row in enumerate(rows):
        variants = [('original',row['input'],row['output'])]
        reversed_request = copy.deepcopy(row['input'])
        reversed_request['candidate_models'].reverse()
        reversed_request['profiles'].reverse()
        variants.append(('reversed',reversed_request,row['output']))
        removed = copy.deepcopy(row['input'])
        winner = row['output']['model_slug']
        removed['candidate_models'].remove(winner)
        removed['profiles'] = [p for p in removed['profiles'] if p['model_slug'] != winner]
        if any(eligible(p,removed) for p in removed['profiles']):
            variants.append(('winner_removed',removed,label(removed,row['metadata']['requirements'])))
        for variant, request, expected in variants:
            started = time.perf_counter()
            raw = router.generate(request)
            elapsed = time.perf_counter()-started
            valid, correct, invalid_slug, constraint_violation, format_valid = False, False, False, False, False
            try:
                decoded = json.loads(raw)
                format_valid = (isinstance(decoded,dict) and set(decoded)=={'model_slug','confidence'}
                    and isinstance(decoded['model_slug'],str)
                    and type(decoded['confidence']) in (int,float) and 0 <= decoded['confidence'] <= 1)
                if isinstance(decoded,dict) and isinstance(decoded.get('model_slug'),str):
                    invalid_slug = decoded['model_slug'] not in request['candidate_models']
                    if not invalid_slug:
                        selected = next(p for p in request['profiles'] if p['model_slug'] == decoded['model_slug'])
                        constraint_violation = not eligible(selected,request)
                result = validate_output(raw,request)
                valid = True
                correct = result['model_slug'] == expected['model_slug']
            except (ValueError,KeyError,TypeError):
                pass
            outcomes.append({'index':index,'variant':variant,'family':row['metadata']['family'],
                'anonymous':row['metadata']['anonymous'],'valid':valid,'correct':correct,'format_valid':format_valid,
                'invalid_slug':invalid_slug,'constraint_violation':constraint_violation,
                'seconds':elapsed,'raw':raw,'expected':expected})
        if (index+1) % 10 == 0:
            print(f'Evaluated {index+1}/{len(rows)} held-out examples',flush=True)
    def metrics(items):
        if not items:
            return None
        return {'count':len(items), 'accuracy':sum(r['correct'] for r in items)/len(items),
            'accepted_rate':sum(r['valid'] for r in items)/len(items),
            'raw_valid_format_rate':sum(r['format_valid'] for r in items)/len(items),
            'raw_invalid_slug_rate':sum(r['invalid_slug'] for r in items)/len(items),
            'raw_constraint_violation_rate':sum(r['constraint_violation'] for r in items)/len(items),
            'latency_median_seconds':statistics.median(r['seconds'] for r in items),
            'latency_p95_seconds':sorted(r['seconds'] for r in items)[min(len(items)-1,int(.95*len(items)))]}
    original = [r for r in outcomes if r['variant']=='original']
    reversed_rows = {r['index']:r for r in outcomes if r['variant']=='reversed'}
    consistent = sum(r['valid'] and reversed_rows[r['index']]['valid'] and
        json.loads(r['raw'])['model_slug']==json.loads(reversed_rows[r['index']]['raw'])['model_slug'] for r in original)
    report = {'model':args.model,'split':args.split,'partial':bool(args.limit),
        'candidate_order_agreement_rate':consistent/len(original),
        'label_meaning':'Agreement with synthetic MVP policy, not measured candidate performance',
        'original':metrics(original),'anonymous':metrics([r for r in original if r['anonymous']]),
        'reversed':metrics([r for r in outcomes if r['variant']=='reversed']),
        'winner_removed':metrics([r for r in outcomes if r['variant']=='winner_removed']),
        'families':{f:metrics([r for r in original if r['family']==f]) for f in sorted({r['family'] for r in original})},
        'outcomes':outcomes}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='outcomes'},indent=2))


if __name__ == '__main__':
    main()
