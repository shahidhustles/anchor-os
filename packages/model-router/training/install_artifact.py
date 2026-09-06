"""Install the downloaded MVP model without overwriting another checkpoint."""
import argparse
import hashlib
import zipfile
from pathlib import Path

MVP_SHA256 = 'ff72f002100ef5ee6074f246a651cf72548c4070546e047e7be7eb9d9c7c80ba'


def install(archive, destination):
    if destination.exists():
        raise ValueError('Destination already exists; choose a new version directory')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != MVP_SHA256:
        raise ValueError('Archive does not match the accepted MVP checkpoint')
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (destination/member.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError('Unsafe archive path')
        bundle.extractall(destination)
    for name in ('model.safetensors', 'config.json', 'tokenizer.json', 'tokenizer_config.json'):
        if not (destination/'merged'/name).is_file():
            raise ValueError(f'Missing model file: {name}')
    print(f'Installed accepted MVP model at {destination / "merged"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    install(args.archive, args.destination)
