import ast, sys
files = [
    'config.py',
    'main.py',
    'orchestrator/pixel.py',
    'generators/heartmula_engine.py',
    'generators/ace_step_engine.py',
    'utils/audio_io.py',
    'orchestrator/song_structure.py',
]
ok = True
for f in files:
    try:
        with open(f, encoding='utf-8') as fh:
            ast.parse(fh.read())
        print(f'OK: {f}')
    except SyntaxError as e:
        print(f'SYNTAX ERROR: {f}: {e}')
        ok = False
    except UnicodeDecodeError as e:
        print(f'ENCODING ERROR: {f}: {e}')
        ok = False
sys.exit(0 if ok else 1)
