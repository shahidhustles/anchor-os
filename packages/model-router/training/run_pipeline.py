"""Run training and evaluation sequentially; persist progress and failures locally."""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='Qwen/Qwen3-0.6B')
    parser.add_argument('--epochs', type=float, default=2)
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--accumulation', type=int, default=16)
    parser.add_argument('--resume')
    args = parser.parse_args()
    output = ROOT/'artifacts/qwen3-router'
    output.mkdir(parents=True,exist_ok=True)
    status_file = output/'pipeline-status.json'
    def status(stage, **details):
        state = {'stage':stage,'updated_at':datetime.now(timezone.utc).isoformat(),**details}
        temporary = status_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(state,indent=2))
        temporary.replace(status_file)
        print(json.dumps(state),flush=True)
    def run(stage, command):
        status(stage)
        with (output/f'{stage}.log').open('a',encoding='utf-8') as log:
            result = subprocess.run([sys.executable,'-u',*command],stdout=log,stderr=subprocess.STDOUT)
        if result.returncode:
            status('failed',failed_stage=stage,exit_code=result.returncode)
            raise SystemExit(result.returncode)
    command = [str(ROOT/'training/train.py'),'--model',args.model,'--output',str(output),
        '--epochs',str(args.epochs),'--batch-size',str(args.batch_size),'--accumulation',str(args.accumulation)]
    if args.resume:
        command += ['--resume',args.resume]
    run('training',command)
    for split in ['validation','test']:
        run(f'evaluating_{split}',[str(ROOT/'training/evaluate.py'),'--model',str(output/'merged'),
            '--split',split,'--report',str(output/f'{split}-report.json')])
        report = json.loads((output/f'{split}-report.json').read_text())
        if report['original']['accuracy'] < .9 or report['original']['accepted_rate'] < 1:
            status('evaluation_below_target',split=split,accuracy=report['original']['accuracy'],
                accepted_rate=report['original']['accepted_rate'],
                note='Checkpoint exists but must not be presented as a validated router. Test set remains untouched if validation failed.')
            return
    status('evaluated',note='Inspect all report categories before enabling Auto. No app integration or PR is performed by this script.')


if __name__ == '__main__':
    main()
