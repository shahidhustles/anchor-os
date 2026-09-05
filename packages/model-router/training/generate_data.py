"""Reproducible synthetic MVP data. Labels are policy estimates, not benchmarks."""
import copy
import hashlib
import json
import random
from collections import Counter
from pathlib import Path
from common import CAPABILITIES, label, validate_request

ROOT = Path(__file__).resolve().parents[1]
# Each subfamily belongs to only one split. Demands are author-assigned metadata.
FAMILIES = {
    'documents': (25, [.6,.2,.85,.9,.9,.9,.5], True, [
        'Read the inspection report for {asset} and create a verified Word approval note with findings and recommendations.',
        'Compare vendor quotations for {asset} and write a formatted procurement recommendation in DOCX.',
        'Extract obligations from the {asset} contract and draft a compliance memo with cited clauses.',
        'Prepare a board briefing from the {asset} audit, including a findings table and a signed-off action section.',
        'Revise the maintenance handover document for {asset}, preserve tables and verify the saved Word file.',
        'Review the scanned incident record for {asset} and produce an approval letter with evidence references.',
    ]),
    'coding': (20, [.8,.94,.84,.2,.8,.83,.5], True, [
        'Fix the Python CSV importer for {asset}; add regression tests and execute them in the sandbox.',
        'Implement a TypeScript validation endpoint for {asset} records and run its test suite.',
        'Repair the SQL migration for {asset}; verify rollback and duplicate-key handling locally.',
        'Debug the concurrent job queue for {asset} and reproduce the race with a failing test before fixing it.',
        'Refactor the {asset} file parser to handle malformed rows and run isolated tests.',
        'Build a command-line inventory checker for {asset} and verify its exit codes with automated tests.',
    ]),
    'reasoning': (15, [.95,.3,.1,.3,.5,.75,.4], False, [
        'Calculate the heat duty for {asset} from the stated flow and temperature values; show units and check the result.',
        'Derive the pressure loss across {asset}, including friction and minor losses, with each numerical step.',
        'Solve the material balance for {asset} including recycle; check conservation and explain assumptions.',
        'Determine the payback period for replacing {asset} using the supplied cash flows and sensitivity cases.',
        'Calculate the thermal expansion allowance for {asset} and verify dimensions throughout.',
        'Estimate the pump shaft power for {asset} using efficiency and head; check the final units.',
    ]),
    'tools': (15, [.8,.4,.92,.8,.9,.92,.6], True, [
        'Search local SOPs for {asset}, inspect the latest report, create an action register and verify all saved files.',
        'Read the image attachments for {asset}, search the local manual and produce a cited repair plan in Word.',
        'Reconcile the {asset} work orders against stock files, update a spreadsheet and check the totals.',
        'Inspect the {asset} video using the local vision tool, locate relevant SOP clauses and save a findings report.',
        'Collect local {asset} inspection records, deduplicate findings and generate a checked management presentation.',
        'Read the handwritten {asset} notes, cross-check the maintenance database and save a verified summary file.',
    ]),
    'long_context': (10, [.75,.2,.2,.86,.65,.85,.94], False, [
        'Summarize the full {asset} operating manual and cite sections for every shutdown condition.',
        'Compare the complete revisions of the {asset} SOP and list conflicting instructions with page references.',
        'Trace every reference to {asset} across the supplied annual reports and give a cited chronology.',
        'Extract exceptions from the complete {asset} policy collection, retaining document and section identifiers.',
        'Analyze recurring {asset} failures across the full archive and cite the source reports.',
        'Find inconsistent limits across the supplied {asset} engineering manuals and quote supporting sections.',
    ]),
    'spreadsheets': (10, [.75,.4,.85,.65,.93,.9,.5], True, [
        'Create an XLSX maintenance budget for {asset} with formulas, formatting and checked totals.',
        'Clean the {asset} inventory workbook, preserve formulas and verify duplicate removal.',
        'Build a downtime chart and pivot summary from {asset} records in a verified Excel workbook.',
        'Extract {asset} readings into schema-valid JSON with exact field names and verify the output file.',
        'Generate an Excel vendor comparison for {asset} with weighted formulas and validate every subtotal.',
        'Repair broken references in the {asset} costing spreadsheet and verify the recalculated values.',
    ]),
    'simple': (5, [.3,.1,.1,.3,.3,.5,.2], False, [
        'Rewrite this short {asset} reminder in polite language.',
        'Give a one-sentence title for the {asset} meeting.',
        'Shorten this {asset} update to two sentences.',
        'Correct the spelling in this brief {asset} notice.',
        'Suggest a subject line for this {asset} email.',
        'Turn these three {asset} bullet points into a short paragraph.',
    ]),
}


def generate():
    rng = random.Random(26117)
    baseline = json.loads((ROOT / 'training-profiles.json').read_text())
    destination = ROOT / 'data'
    destination.mkdir(exist_ok=True)
    manifest = {'seed': 26117, 'provenance': 'Template-generated synthetic MVP; author-assigned demands and policy labels. No measured model quality.', 'splits': {}}
    for split, size, indices in [('train', 6400, [0,1,2,3]), ('validation', 800, [4]), ('test', 800, [5])]:
        rows = []
        for family, (share, demands, tools, templates) in FAMILIES.items():
            for i in range(size * share // 100):
                variant = rng.choice(indices)
                asset = rng.choice(['boiler', 'compressor', 'heat exchanger', 'storage tank', 'transfer pump', 'cooling tower']) + f' unit {rng.randint(1,999)}'
                task = templates[variant].format(asset=asset)
                profiles = copy.deepcopy(rng.sample(baseline, rng.randint(2,6)))
                synthetic = rng.random() < .65
                if synthetic:
                    for p in profiles:
                        p['capabilities'] = {k: round(max(.1, min(.99, v + rng.uniform(-.18,.18))), 2) for k,v in p['capabilities'].items()}
                        p['runtime']['tokens_per_second'] = round(p['runtime']['tokens_per_second'] * rng.uniform(.5,2), 1)
                        p['runtime']['peak_vram_gb'] = round(p['runtime']['peak_vram_gb'] * rng.uniform(.5,1.5), 1)
                anonymous = rng.random() < .5
                if anonymous:
                    for p, identifier in zip(profiles, rng.sample(range(100,999), len(profiles))):
                        p['model_slug'] = f'model_{identifier}'
                request = {'user_task': task, 'candidate_models': [p['model_slug'] for p in profiles], 'profiles': profiles,
                           'requires_tools': tools, 'input_tokens': rng.choice([48000,96000,180000]) if family == 'long_context' else 1024}
                if not any((not tools or p['features']['tool_calling']) and p['runtime']['usable_context'] >= request['input_tokens'] for p in profiles):
                    # Regenerate eligibility within the placeholder profile domain, never mislabel an impossible request.
                    profiles[0]['features']['tool_calling'] = True
                    profiles[0]['runtime']['usable_context'] = max(profiles[0]['runtime']['usable_context'], request['input_tokens'])
                    synthetic = True
                requirements = dict(zip(CAPABILITIES, demands))
                validate_request(request)
                rows.append({'input': request, 'output': label(request, requirements), 'metadata': {
                    'family': family, 'subfamily': f'{family}_{variant}', 'anonymous': anonymous,
                    'synthetic_profiles': synthetic, 'requirements': requirements}})
        rng.shuffle(rows)
        content = ''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in rows)
        (destination / f'{split}.jsonl').write_text(content, encoding='utf-8', newline='\n')
        manifest['splits'][split] = {'count':len(rows), 'sha256':hashlib.sha256(content.encode()).hexdigest(),
            'families':dict(Counter(r['metadata']['family'] for r in rows)),
            'anonymous':sum(r['metadata']['anonymous'] for r in rows)}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    generate()
