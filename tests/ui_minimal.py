"""Compatibility entry point: the two-tab suite supersedes the old UX checks."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('ui_two_tabs.py')), run_name='__main__')
